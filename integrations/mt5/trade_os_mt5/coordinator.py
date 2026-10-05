"""One account's durable controls and bounded capture/upload scheduling.

No terminal discovery, orders, account switching, credential export or shell.
The caller owns the stop event; each tick runs at most one capture
and two upload subprocesses. Pending history drains before new broker reads.
Startup installation, browser consent CLI and application monitoring are separate.
"""

import math
import sqlite3
import threading
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .broker import TerminalBinding
from .oauth import OAuthConfiguration
from .outbox import Binding, Outbox, OutboxError, _instant
from .supervisor import (
    ATTENTION_CODES,
    RETRYABLE_CODES,
    SupervisorError,
    _spool_path,
    supervised_capture,
    supervised_upload,
)
from .uploader import retry_delay
from .windows_security import SingleInstance, restrict_access

POLL_SECONDS = 15
HEARTBEAT_SECONDS = 30
STALE_SECONDS = 120
PROCESS_RETRYABLE = {"WORKER_STALLED", "WORKER_CRASHED", "WORKER_START_FAILED"}
PROCESS_ATTENTION = {
    "INVALID_WORKER_RESPONSE",
    "WORKER_HANDLE_RECOVERY_REQUIRED",
    "WORKER_TERMINATION_REQUIRES_ATTENTION",
    "CLOCK_REQUIRES_ATTENTION",
}


class Coordinator:
    def __init__(
        self,
        binding: Binding,
        terminal: TerminalBinding,
        configuration: OAuthConfiguration,
        spool: Path,
        *,
        capture=supervised_capture,
        upload=supervised_upload,
        now=lambda: datetime.now(UTC),
        monotonic=time.monotonic,
        delay=retry_delay,
    ):
        binding = binding.normalized()
        terminal.validate()
        scope = configuration.scope()
        if scope["ownerId"] != binding.owner_id or scope["accountId"] != binding.account_id:
            raise SupervisorError("INVALID_WORKER_CONFIGURATION")
        self.spool = Path(_spool_path(spool, binding))
        if not self.spool.parent.is_dir():
            raise SupervisorError("INVALID_WORKER_CONFIGURATION")
        # Restrict only this approved connection directory, never its ancestors.
        restrict_access(self.spool.parent)
        self.lock = SingleInstance(self.spool.parent / "collector.lock")
        try:
            self.box = Outbox(self.spool, binding)
            instant = now()
            if not isinstance(instant, datetime) or instant.tzinfo is None:
                raise SupervisorError("INVALID_CLOCK_CONFIGURATION")
            self.worker_id = self.box.start_generation(self._utc(instant.astimezone(UTC)))
        except BaseException:
            if hasattr(self, "box"):
                self.box.close()
            self.lock.close()
            raise
        self.binding, self.terminal, self.configuration = (
            binding,
            replace(terminal, identity=dict(terminal.identity)),
            configuration,
        )
        self.capture, self.upload, self.now, self.monotonic, self.delay = capture, upload, now, monotonic, delay
        self.next_capture = self.next_heartbeat = self.next_retry = 0.0
        self.previous_tick = None
        self.previous_wall = None
        self.previous_mode = None
        self.lease_expiry = None
        self.failures = 0
        self.retry_code = None

    def close(self):
        try:
            self.box.close()
        finally:
            self.lock.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _clock(self):
        instant, steady = self.now(), self.monotonic()
        if (
            not isinstance(instant, datetime)
            or instant.tzinfo is None
            or type(steady) not in (int, float)
            or not math.isfinite(steady)
            or steady < 0
        ):
            raise SupervisorError("INVALID_CLOCK_CONFIGURATION")
        return instant.astimezone(UTC), steady

    @staticmethod
    def _utc(instant):
        return instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def _upload(self):
        if self.box.runtime()["worker_id"] != self.worker_id:
            raise SupervisorError("WORKER_REQUIRES_ATTENTION")
        result = self.upload(self.binding, self.configuration, self.spool, self.worker_id)
        # The public adapter validates all result fields; this extra guard ensures
        # a lease is fresh enough before the next bounded native capture.
        expiry = datetime.fromisoformat(_instant(result["leaseExpiresAt"]))
        wall, steady = self._clock()
        if expiry <= wall + timedelta(seconds=15):
            raise SupervisorError("INTEGRATION_UNAVAILABLE", retryable=True)
        self.lease_expiry = expiry
        self.box.mark_runtime_time("last_contact_at", self._utc(wall))
        self.next_heartbeat = steady + HEARTBEAT_SECONDS
        return result

    def status(self):
        state = self.box.runtime()
        wall, steady = self._clock()
        contacted = state["last_contact_at"]
        contacted_at = datetime.fromisoformat(contacted) if contacted else None
        stale = contacted_at is None or wall < contacted_at or wall - contacted_at >= timedelta(seconds=STALE_SECONDS)
        captured, confirmed = self.box.checkpoints()
        return {
            "connectionId": self.binding.connection_id,
            "mode": state["mode"],
            "state": "RETRYING" if state["mode"] == "RUNNING" and self.retry_code else state["mode"],
            "code": state["attention_code"] or self.retry_code,
            "stale": stale,
            "pendingPages": self.box.pending_count(),
            "captureCheckpoint": captured,
            "serverCheckpoint": confirmed,
            "lastContactAt": contacted,
            "lastFullHistoryAt": state["last_full_history_at"],
            "retryAfterSeconds": max(0, self.next_retry - steady) if self.retry_code else None,
        }

    def tick(self) -> float:
        """Return interruptible seconds until next action; never sleep here.

        Newly created spools are PAUSED. Resume is an explicit durable operator
        action. ATTENTION survives restart and cannot be cleared by this method.
        """
        try:
            return self._tick()
        except (OutboxError, sqlite3.Error, OSError):
            # Disk-full/corruption are not transient network failures. Preserve
            # the spool and stop. If persisting attention also fails, propagate a
            # redacted error so an outer supervisor cannot claim healthy progress.
            try:
                self.box.set_mode(
                    "ATTENTION",
                    "OUTBOX_REQUIRES_ATTENTION",
                    self._utc(self.now().astimezone(UTC)),
                    attention_code="OUTBOX_REQUIRES_ATTENTION",
                )
            except (OutboxError, sqlite3.Error, OSError):
                raise SupervisorError("OUTBOX_REQUIRES_ATTENTION") from None
            return 1.0

    def _tick(self):
        wall, steady = self._clock()
        state = self.box.runtime()
        discontinuity = self.previous_tick is not None and (
            steady < self.previous_tick or steady - self.previous_tick >= STALE_SECONDS or wall < self.previous_wall
        )
        if self.previous_mode != state["mode"] or discontinuity:
            self.next_capture = self.next_heartbeat = self.next_retry = 0.0
            self.lease_expiry = None
            self.retry_code = None
            self.failures = 0
        self.previous_tick, self.previous_wall, self.previous_mode = steady, wall, state["mode"]
        if state["mode"] != "RUNNING":
            return 1.0  # Observe externally committed local pause/resume promptly.
        if steady < self.next_retry:
            return min(1.0, self.next_retry - steady)
        try:
            captured, _ = self.box.checkpoints()
            if captured is not None and datetime.fromisoformat(captured) > wall:
                # An authoritative UTC capture cannot be safely dated earlier
                # than the existing cursor. Preserve it and request clock repair.
                raise SupervisorError("CLOCK_REQUIRES_ATTENTION")
            if self.box.pending_count() or steady >= self.next_heartbeat:
                self._upload()  # Replay existing history before new collection.
            if self.box.pending_count():
                self._healthy()
                return 0.0
            wall, steady = self._clock()
            if steady >= self.next_capture:
                # Reserve the complete 45s worker deadline plus a 15s margin.
                # Sleep/wake or an old lost ACK must not authorize a broker read.
                if self.lease_expiry is None or self.lease_expiry <= wall + timedelta(seconds=60):
                    self._upload()
                    wall, steady = self._clock()
                    if self.lease_expiry <= wall + timedelta(seconds=60):
                        raise SupervisorError("INTEGRATION_UNAVAILABLE", retryable=True)
                last_full = state["last_full_history_at"]
                full_at = datetime.fromisoformat(last_full) if last_full else None
                full = full_at is None or wall < full_at or wall - full_at >= timedelta(days=1)
                captured, _ = self.box.checkpoints()
                result = self.capture(self.binding, self.terminal, self.spool, checkpoint=captured, full_history=full)
                # A success reply is not evidence of a commit without the spool.
                if self.box.checkpoints()[0] != result["checkpoint"] or self.box.pending_count() < 1:
                    raise SupervisorError("INVALID_WORKER_RESPONSE")
                finished, steady = self._clock()
                if full:
                    self.box.mark_runtime_time("last_full_history_at", self._utc(finished))
                self.next_capture = steady + POLL_SECONDS
                self._upload()
            self._healthy()
            _, steady = self._clock()
            if self.box.pending_count():
                return 0.0
            return min(1.0, max(0.0, min(self.next_capture, self.next_heartbeat) - steady))
        except SupervisorError as error:
            if error.retryable and error.code in RETRYABLE_CODES | PROCESS_RETRYABLE:
                _, steady = self._clock()
                wait = self.delay(self.failures)
                if type(wait) not in (int, float) or not math.isfinite(wait) or not 0 <= wait <= 60:
                    raise SupervisorError("INVALID_RETRY_CONFIGURATION") from None
                self.next_retry = steady + wait
                self.failures += 1
                self.retry_code = error.code
                self.lease_expiry = None
                self.next_capture = self.next_heartbeat = 0.0
                return min(1.0, wait)
            code = error.code if error.code in ATTENTION_CODES | PROCESS_ATTENTION else "WORKER_REQUIRES_ATTENTION"
            self.box.set_mode("ATTENTION", code, self._utc(self.now().astimezone(UTC)), attention_code=code)
            self.lease_expiry = None
            self.retry_code = None
            return 1.0

    def _healthy(self):
        self.next_retry = 0.0
        self.retry_code = None
        self.failures = 0

    def run_until_stopped(self, stop: threading.Event) -> dict:
        """Interruptible local loop, called within the coordinator context.

        Stop is observed between bounded operations (up to 45s each), or within
        one second while idle/backing off. Ctrl+C also terminates the owned child
        through the supervisor. No background Python thread is created; terminals
        are never terminated by this loop or its worker guard.
        """
        if not isinstance(stop, threading.Event):
            raise SupervisorError("INVALID_WORKER_CONFIGURATION")
        while not stop.is_set():
            stop.wait(self.tick())
        return self.status()

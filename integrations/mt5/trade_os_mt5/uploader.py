"""Account-bound resumable uploader. Scheduling and broker collection are separate."""

import random
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from .api import ApiError, IntegrationApi
from .outbox import Outbox, RecoveryRequired, _uuid


def retry_delay(attempt: int, jitter: Callable[[], float] = random.random) -> float:
    """Full jitter exponential delay; transport/control time, never monetary math."""
    if type(attempt) is not int or attempt < 0:
        raise ValueError("Invalid retry attempt")
    return min(60, 2 ** min(attempt, 6)) * max(0, min(1, jitter()))


class Uploader:
    def __init__(
        self,
        api: IntegrationApi,
        outbox: Outbox,
        worker_id: str,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        self.api, self.outbox, self.worker_id = api, outbox, _uuid(worker_id)
        self.now = now
        self.lease: dict[str, Any] | None = None
        self.renewed_at: datetime | None = None

    def ensure_lease(self) -> dict[str, Any]:
        now = self.now()
        if now.tzinfo is None:
            raise ApiError("INVALID_CLOCK_CONFIGURATION")
        if (
            self.lease is not None
            and self.renewed_at is not None
            and now >= self.renewed_at
            and now - self.renewed_at < timedelta(seconds=30)
            and datetime.fromisoformat(self.lease["leaseExpiresAt"]) > now + timedelta(seconds=15)
        ):
            return self.lease
        self.api.verify_binding(self.outbox.binding)
        # At most one extra request: a replayed lost acknowledgement may describe
        # a lease that expired while offline. Record it, then claim a fresh operation.
        for _ in range(2):
            request = self.outbox.prepare_lease(self.worker_id)
            lease = self.api.acquire_lease(request)
            self.outbox.acknowledge_lease(request["operationId"], lease)
            now = self.now()
            if datetime.fromisoformat(lease["leaseExpiresAt"]) > now + timedelta(seconds=15):
                self.lease, self.renewed_at = lease, now
                return lease
        raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True)

    def upload_one(self) -> bool:
        """One durable page at a time. Errors leave pending requests intact."""
        if self.outbox.pending_count() == 0:
            return False
        lease = self.ensure_lease()
        try:
            request = self.outbox.next_attempt(self.worker_id, lease["fencingToken"])
        except RecoveryRequired:
            prior = self.outbox.uncertain_attempt()
            if prior is None:
                raise ApiError("COLLECTOR_REQUIRES_ATTENTION") from None
            # The current lease is already verified; a greater fence makes any
            # older in-flight write fail before an UNKNOWN observation is trusted.
            if int(lease["fencingToken"]) <= int(prior["fencingToken"]):
                raise ApiError("COLLECTOR_REQUIRES_ATTENTION") from None
            receipt = self.api.operation(prior["operationId"], self.outbox.binding.connection_id)
            if receipt["status"] == "COMMITTED":
                if receipt["kind"] != "MT5_CAPTURE":
                    raise ApiError("OPERATION_CONFLICT") from None
                self.outbox.acknowledge(prior["operationId"], receipt["result"])
                return True
            self.outbox.recover_unknown(prior["operationId"], receipt, self.worker_id, lease["fencingToken"])
            request = self.outbox.next_attempt(self.worker_id, lease["fencingToken"])
        if request is None:
            return False
        try:
            result = self.api.capture(request)
        except ApiError as error:
            if error.code == "COLLECTOR_REQUIRES_ATTENTION":
                # Do not keep presenting a cached expired/stale lease on later
                # explicitly requested recovery. The supervisor still pauses.
                self.lease = None
            raise
        self.outbox.acknowledge(request["operationId"], result)
        return True

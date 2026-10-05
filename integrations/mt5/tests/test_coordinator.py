import sqlite3
import threading
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from test_outbox import ACCOUNT, CHECKPOINT, CONNECTION, EVENT, IDENTITY, OWNER, WORKER, receipt

from trade_os_mt5.broker import TerminalBinding
from trade_os_mt5.coordinator import Coordinator
from trade_os_mt5.oauth import OAuthConfiguration
from trade_os_mt5.outbox import Binding, Outbox, OutboxError
from trade_os_mt5.supervisor import SupervisorError
from trade_os_mt5.windows_security import CredentialError


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-coordinator-test-")
        self.root = Path(self.temp.name)
        self.spool = self.root / CONNECTION / "outbox.sqlite3"
        self.spool.parent.mkdir()
        executable = self.root / "terminal64.exe"
        executable.touch()
        data = self.root / "data"
        data.mkdir()
        self.binding = Binding(OWNER, ACCOUNT, CONNECTION)
        self.terminal = TerminalBinding(executable, data, dict(IDENTITY), True)
        self.configuration = OAuthConfiguration(
            "https://fixture.supabase.co/auth/v1", "https://trade.example", OWNER, ACCOUNT, WORKER
        )
        self.now = datetime(2026, 1, 1, tzinfo=UTC)
        self.steady = 100.0
        self.calls = []
        self.upload_error = self.capture_error = None
        self.short_lease = False
        self.coordinator = self.make()

    def make(self):
        return Coordinator(
            self.binding,
            self.terminal,
            self.configuration,
            self.spool,
            capture=self.capture,
            upload=self.upload,
            now=lambda: self.now,
            monotonic=lambda: self.steady,
            delay=lambda failures: min(60, 2 ** min(failures, 6)),
        )

    def tearDown(self):
        self.coordinator.close()
        self.temp.cleanup()

    def instant(self):
        return self.now.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def advance(self, seconds):
        self.now += timedelta(seconds=seconds)
        self.steady += seconds

    def start(self):
        self.coordinator.box.set_mode("RUNNING", "Operator approved demo collection", self.instant())

    def capture(self, binding, terminal, spool, **kwargs):
        self.calls.append(("capture", kwargs))
        if self.capture_error:
            raise self.capture_error
        box = Outbox(spool, binding)
        try:
            collected = box.enqueue(IDENTITY, self.instant(), [[EVENT]])
            return {
                "kind": "CAPTURED",
                "connectionId": CONNECTION,
                "collectionId": collected,
                "checkpoint": self.instant(),
                "pendingPages": box.pending_count(),
            }
        finally:
            box.close()

    def upload(self, binding, configuration, spool, worker_id):
        self.calls.append(("upload", worker_id))
        if self.upload_error:
            raise self.upload_error
        box = Outbox(spool, binding)
        try:
            request = box.next_attempt(worker_id, "1")
            if request:
                manifest = request["collection"]
                complete = manifest["index"] + 1 == manifest["count"]
                box.acknowledge(
                    request["operationId"],
                    receipt(
                        request,
                        complete=complete,
                        count=manifest["index"] + 1,
                        checkpoint=request["checkpoint"] if complete else None,
                    ),
                )
            captured, confirmed = box.checkpoints()
            return {
                "kind": "UPLOADED",
                "connectionId": CONNECTION,
                "pendingPages": box.pending_count(),
                "captureCheckpoint": captured,
                "serverCheckpoint": confirmed,
                "leaseExpiresAt": (self.now + timedelta(seconds=20 if self.short_lease else 120))
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
            }
        finally:
            box.close()

    def test_new_spool_is_paused_and_no_network_or_terminal_runs_without_resume(self):
        self.assertEqual(self.coordinator.tick(), 1)
        self.assertEqual(self.coordinator.status()["mode"], "PAUSED")
        self.assertEqual(self.calls, [])
        self.assertTrue(self.coordinator.status()["stale"])

    def test_first_start_verifies_lease_then_captures_full_history_then_uploads(self):
        self.start()
        self.coordinator.tick()
        self.assertEqual([call[0] for call in self.calls], ["upload", "capture", "upload"])
        self.assertEqual(self.calls[1][1], {"checkpoint": None, "full_history": True})
        status = self.coordinator.status()
        self.assertFalse(status["stale"])
        self.assertEqual(status["pendingPages"], 0)
        self.assertEqual(status["captureCheckpoint"], self.instant())
        self.assertEqual(status["serverCheckpoint"], self.instant())

    def test_subsequent_capture_is_due_at_fifteen_seconds_not_before(self):
        self.start()
        self.coordinator.tick()
        self.advance(14)
        self.coordinator.tick()
        self.assertEqual(len([call for call in self.calls if call[0] == "capture"]), 1)
        self.advance(1)
        self.coordinator.tick()
        self.assertEqual(self.calls[-2], ("capture", {"checkpoint": CHECKPOINT, "full_history": False}))

    def test_idle_heartbeat_due_at_thirty_seconds_without_new_capture(self):
        self.start()
        self.coordinator.tick()
        self.coordinator.next_capture = self.steady + 1000
        self.advance(29)
        self.coordinator.tick()
        self.assertEqual(len(self.calls), 3)
        self.advance(1)
        self.coordinator.tick()
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(self.calls[-1][0], "upload")

    def test_pending_history_drains_before_broker_reads(self):
        self.coordinator.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT], [EVENT]])
        self.start()
        self.assertEqual(self.coordinator.tick(), 0)
        self.assertEqual([call[0] for call in self.calls], ["upload"])
        self.coordinator.tick()
        self.assertEqual([call[0] for call in self.calls], ["upload", "upload", "capture", "upload"])
        self.assertEqual(self.coordinator.box.pending_count(), 0)

    def test_failed_network_retries_backoff_without_new_capture_or_data_loss(self):
        self.coordinator.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.start()
        self.upload_error = SupervisorError("INTEGRATION_UNAVAILABLE", retryable=True)
        self.coordinator.tick()
        self.assertEqual(self.coordinator.status()["state"], "RETRYING")
        self.assertEqual(self.coordinator.status()["retryAfterSeconds"], 1)
        self.coordinator.tick()
        self.assertEqual(len(self.calls), 1)
        self.advance(1)
        self.coordinator.tick()
        self.assertEqual(self.coordinator.status()["retryAfterSeconds"], 2)
        self.assertEqual(self.coordinator.box.pending_count(), 1)
        self.upload_error = None
        self.advance(2)
        self.coordinator.tick()
        self.assertEqual(self.coordinator.box.pending_count(), 0)
        self.assertEqual(self.coordinator.status()["state"], "RUNNING")
        self.assertEqual(self.calls[-2][1]["checkpoint"], CHECKPOINT)

    def test_worker_stall_restarts_only_after_backoff_with_approved_mapping(self):
        self.start()
        self.capture_error = SupervisorError("WORKER_STALLED", retryable=True)
        self.coordinator.tick()
        self.assertEqual(self.coordinator.status()["code"], "WORKER_STALLED")
        self.assertEqual(self.coordinator.box.checkpoints(), (None, None))
        self.advance(1)
        self.capture_error = None
        self.coordinator.tick()
        self.assertEqual(self.coordinator.status()["state"], "RUNNING")

    def test_identity_auth_and_unknown_failures_require_attention_and_survive_restart(self):
        for code in ("MT5_ACCOUNT_IDENTITY_MISMATCH", "INTEGRATION_ACCESS_DENIED", "UNKNOWN_SECRET"):
            self.start()
            self.upload_error = SupervisorError(code, retryable=True)
            self.coordinator.tick()
            status = self.coordinator.status()
            self.assertEqual(status["mode"], "ATTENTION")
            self.assertEqual(status["code"], code if code != "UNKNOWN_SECRET" else "WORKER_REQUIRES_ATTENTION")
            self.coordinator.close()
            self.coordinator = self.make()
            before = len(self.calls)
            self.coordinator.tick()
            self.assertEqual(len(self.calls), before)
            self.assertEqual(self.coordinator.status()["mode"], "ATTENTION")

    def test_short_lease_never_authorizes_a_native_capture(self):
        self.start()
        self.short_lease = True
        self.coordinator.tick()
        self.assertFalse(any(call[0] == "capture" for call in self.calls))
        self.assertEqual(self.coordinator.status()["state"], "RETRYING")

    def test_sleep_wake_rechecks_lease_and_collects_overlap_without_catchup_storm(self):
        self.start()
        self.coordinator.tick()
        self.advance(10000)
        self.coordinator.tick()
        self.assertEqual([call[0] for call in self.calls][-3:], ["upload", "capture", "upload"])
        self.assertEqual(self.calls[-2][1], {"checkpoint": CHECKPOINT, "full_history": False})
        self.assertEqual(len([call for call in self.calls if call[0] == "capture"]), 2)

    def test_daily_full_reconciliation_marker_survives_restart(self):
        self.start()
        self.coordinator.tick()
        worker = self.coordinator.box.runtime()["worker_id"]
        self.coordinator.close()
        self.coordinator = self.make()
        self.advance(10)
        self.coordinator.tick()
        self.assertFalse(self.calls[-2][1]["full_history"])
        self.assertNotEqual(self.coordinator.box.runtime()["worker_id"], worker)
        self.advance(86400)
        self.coordinator.tick()
        self.assertTrue(self.calls[-2][1]["full_history"])

    def test_paused_mode_survives_restart_and_resume_is_audited(self):
        self.start()
        self.coordinator.tick()
        self.coordinator.box.set_mode("PAUSED", "Operator paused for maintenance", self.instant())
        self.coordinator.close()
        self.coordinator = self.make()
        before = len(self.calls)
        self.coordinator.tick()
        self.assertEqual(len(self.calls), before)
        self.start()
        self.coordinator.tick()
        self.assertEqual([call[0] for call in self.calls][-3:], ["upload", "capture", "upload"])
        events = self.coordinator.box.db.execute(
            "select previous_mode,new_mode from collector_control_events order by sequence"
        ).fetchall()
        self.assertEqual(
            [tuple(row) for row in events], [("PAUSED", "RUNNING"), ("RUNNING", "PAUSED"), ("PAUSED", "RUNNING")]
        )
        for query in ("delete from collector_control_events", "update collector_control_events set reason='rewritten'"):
            with self.assertRaises(sqlite3.IntegrityError):
                self.coordinator.box.db.execute(query)

    def test_two_actual_coordinators_cannot_own_same_account_spool(self):
        with self.assertRaises(CredentialError) as error:
            self.make()
        self.assertEqual(error.exception.code, "COLLECTOR_ALREADY_RUNNING")
        self.coordinator.close()
        self.coordinator = self.make()

    def test_old_spool_upgrade_preserves_pending_operation_and_checkpoints(self):
        box = self.coordinator.box
        box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        request = box.next_attempt(WORKER, "1")
        box.db.execute("drop table collector_runtime")
        box.db.execute("pragma user_version=2")
        self.coordinator.close()
        self.coordinator = self.make()
        self.assertEqual(self.coordinator.box.db.execute("pragma user_version").fetchone()[0], 3)
        self.assertEqual(self.coordinator.box.next_attempt(WORKER, "1"), request)
        self.assertEqual(self.coordinator.box.checkpoints(), (CHECKPOINT, None))
        self.assertEqual(self.coordinator.box.runtime()["mode"], "PAUSED")

    def test_failed_capture_never_advances_daily_reconciliation_marker(self):
        self.start()
        self.capture_error = SupervisorError("BROKER_READ_UNAVAILABLE", retryable=True)
        self.coordinator.tick()
        self.assertIsNone(self.coordinator.box.runtime()["last_full_history_at"])
        self.assertEqual(self.coordinator.box.checkpoints(), (None, None))

    def test_disk_failure_stops_without_silently_resetting_spool(self):
        self.start()
        self.coordinator.capture = lambda *args, **kwargs: (_ for _ in ()).throw(
            sqlite3.OperationalError("SECRET disk full")
        )
        self.coordinator.tick()
        self.assertEqual(self.coordinator.status()["mode"], "ATTENTION")
        self.assertEqual(self.coordinator.status()["code"], "OUTBOX_REQUIRES_ATTENTION")
        self.assertEqual(self.coordinator.box.checkpoints(), (None, None))

    def test_invalid_controls_and_arbitrary_runtime_fields_are_rejected(self):
        box = self.coordinator.box
        for mode, reason, code in (
            ("RUNNING", "", ""),
            ("RUNNING", "Meaningful reason", "ERROR"),
            ("ATTENTION", "Meaningful reason", None),
        ):
            with self.assertRaises(OutboxError):
                box.set_mode(mode, reason, CHECKPOINT, attention_code=code)
        with self.assertRaises(OutboxError):
            box.mark_runtime_time("worker_id", str(uuid4()))
        self.assertEqual(box.runtime()["mode"], "PAUSED")

    def test_backward_clock_preserves_cursor_and_requires_clock_repair(self):
        self.start()
        self.coordinator.tick()
        self.now -= timedelta(seconds=1)
        self.steady += 1
        self.coordinator.tick()
        self.assertEqual(self.coordinator.status()["mode"], "ATTENTION")
        self.assertEqual(self.coordinator.status()["code"], "CLOCK_REQUIRES_ATTENTION")
        self.assertEqual(self.coordinator.box.checkpoints(), (CHECKPOINT, CHECKPOINT))
        self.assertEqual(len([call for call in self.calls if call[0] == "capture"]), 1)

    def test_copied_vps_spool_starts_as_a_distinct_collector_generation(self):
        with TemporaryDirectory(prefix="trade-os-copy-test-") as target:
            path = Path(target) / CONNECTION / "outbox.sqlite3"
            path.parent.mkdir()
            destination = sqlite3.connect(path)
            try:
                self.coordinator.box.db.backup(destination)
            finally:
                destination.close()
            with Coordinator(
                self.binding,
                self.terminal,
                self.configuration,
                path,
                capture=self.capture,
                upload=self.upload,
                now=lambda: self.now,
                monotonic=lambda: self.steady,
            ) as replacement:
                self.assertNotEqual(replacement.worker_id, self.coordinator.worker_id)
                generations = replacement.box.db.execute(
                    "select worker_id from collector_generations order by sequence"
                ).fetchall()
                self.assertEqual([row[0] for row in generations], [self.coordinator.worker_id, replacement.worker_id])
                self.assertEqual(replacement.box.runtime()["mode"], "PAUSED")
                with self.assertRaises(sqlite3.IntegrityError):
                    replacement.box.db.execute("delete from collector_generations")

    def test_original_terminal_config_cannot_be_mutated_to_retarget_coordinator(self):
        self.terminal.identity["login"] = "98765"
        self.assertEqual(self.coordinator.terminal.identity["login"], IDENTITY["login"])

    def test_stale_status_changes_at_exactly_one_hundred_twenty_seconds(self):
        self.start()
        self.coordinator.tick()
        self.advance(119)
        self.assertFalse(self.coordinator.status()["stale"])
        self.advance(1)
        self.assertTrue(self.coordinator.status()["stale"])

    def test_control_change_and_evidence_are_atomic_when_state_update_fails(self):
        box = self.coordinator.box
        box.db.execute("""create trigger injected_control_failure before update of mode on collector_runtime
            begin select raise(abort,'Injected fixture failure'); end""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.start()
        self.assertEqual(box.runtime()["mode"], "PAUSED")
        self.assertEqual(box.db.execute("select count(*) from collector_control_events").fetchone()[0], 0)

    def test_stopped_loop_never_starts_network_or_capture(self):
        stop = threading.Event()
        stop.set()
        result = self.coordinator.run_until_stopped(stop)
        self.assertEqual(result["mode"], "PAUSED")
        self.assertEqual(self.calls, [])

    def test_loop_wait_is_interruptible_without_real_clock_sleep_or_background_threads(self):
        class StopAfterFirstWait(threading.Event):
            def wait(self, timeout=None):
                self.observed_timeout = timeout
                self.set()
                return True

        stop = StopAfterFirstWait()
        result = self.coordinator.run_until_stopped(stop)
        self.assertEqual(stop.observed_timeout, 1)
        self.assertEqual(result["mode"], "PAUSED")
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from test_outbox import ACCOUNT, CHECKPOINT, CONNECTION, EVENT, IDENTITY, NEW_WORKER, OWNER, WORKER, receipt

from trade_os_mt5.api import ApiError
from trade_os_mt5.outbox import Binding, Outbox
from trade_os_mt5.uploader import Uploader, retry_delay


class FakeApi:
    def __init__(self):
        self.now = datetime(2026, 1, 1, tzinfo=UTC)
        self.fence = "1"
        self.calls = []
        self.results = {}
        self.error = None
        self.lose_capture_ack = False
        self.lose_lease_ack = False
        self.lease_results = {}

    def verify_binding(self, binding):
        self.calls.append(("verify", binding))

    def acquire_lease(self, request):
        self.calls.append(("lease", request.copy()))
        result = self.lease_results.setdefault(
            request["operationId"],
            {
                "connectionId": CONNECTION,
                "fencingToken": self.fence,
                "leaseExpiresAt": (self.now + timedelta(seconds=120))
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
            },
        )
        if self.lose_lease_ack:
            self.lose_lease_ack = False
            raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True)
        return result

    def capture(self, request):
        self.calls.append(("capture", request.copy()))
        if self.error:
            raise self.error
        result = self.results.setdefault(request["operationId"], receipt(request, complete=True, checkpoint=CHECKPOINT))
        if self.lose_capture_ack:
            self.lose_capture_ack = False
            raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True)
        return result

    def operation(self, operation_id, connection_id):
        self.calls.append(("lookup", operation_id))
        if operation_id in self.results:
            return {
                "operationId": operation_id,
                "status": "COMMITTED",
                "kind": "MT5_CAPTURE",
                "result": self.results[operation_id],
            }
        return {"operationId": operation_id, "status": "UNKNOWN"}


class UploaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-uploader-test-")
        self.path = Path(self.temp.name) / "outbox.sqlite3"
        self.box = Outbox(self.path, Binding(OWNER, ACCOUNT, CONNECTION))
        self.api = FakeApi()
        self.uploader = Uploader(self.api, self.box, WORKER, now=lambda: self.api.now)

    def tearDown(self):
        self.box.close()
        self.temp.cleanup()

    def test_empty_outbox_makes_no_authenticated_network_calls(self):
        self.assertFalse(self.uploader.upload_one())
        self.assertEqual(self.api.calls, [])

    def test_uncertain_lookup_never_skips_an_older_page_without_an_attempt(self):
        first = self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        # Reproduce an unusual partially restored spool, without uploading data.
        self.box.db.execute("update pages set acknowledged=1 where collection_id=?", (first,))
        later = self.box.next_attempt(WORKER, "1")
        self.box.db.execute("update pages set acknowledged=0 where collection_id=?", (first,))
        self.assertIsNone(self.box.uncertain_attempt())
        oldest = self.box.next_attempt(WORKER, "1")
        self.assertEqual(oldest["collection"]["id"], first)
        self.assertNotEqual(later["operationId"], oldest["operationId"])

    def test_upload_checks_mapping_before_lease_and_capture(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.assertTrue(self.uploader.upload_one())
        self.assertEqual([kind for kind, _ in self.api.calls], ["verify", "lease", "capture"])
        self.assertEqual(self.box.pending_count(), 0)

    def test_lost_capture_ack_retries_exact_same_operation_and_payload(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.api.lose_capture_ack = True
        with self.assertRaises(ApiError):
            self.uploader.upload_one()
        self.assertEqual(self.box.pending_count(), 1)
        self.assertTrue(self.uploader.upload_one())
        captures = [request for kind, request in self.api.calls if kind == "capture"]
        self.assertEqual(captures[0], captures[1])
        self.assertEqual(len(self.api.results), 1)

    def test_lost_lease_ack_retries_durable_original_lease_request(self):
        self.api.lose_lease_ack = True
        with self.assertRaises(ApiError):
            self.uploader.ensure_lease()
        self.uploader.ensure_lease()
        leases = [request for kind, request in self.api.calls if kind == "lease"]
        self.assertEqual(leases[0], leases[1])
        self.assertEqual(len(self.api.lease_results), 1)

    def test_lost_ack_of_now_expired_lease_is_recorded_then_fresh_lease_claimed(self):
        self.api.lose_lease_ack = True
        with self.assertRaises(ApiError):
            self.uploader.ensure_lease()
        self.api.now += timedelta(seconds=130)
        self.api.fence = "2"
        self.assertEqual(self.uploader.ensure_lease()["fencingToken"], "2")
        leases = [request for kind, request in self.api.calls if kind == "lease"]
        self.assertEqual(leases[0], leases[1])
        self.assertNotEqual(leases[1]["operationId"], leases[2]["operationId"])

    def test_new_fence_then_lookup_acknowledges_committed_original_without_recapture(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.api.lose_capture_ack = True
        with self.assertRaises(ApiError):
            self.uploader.upload_one()
        self.api.now += timedelta(seconds=130)
        self.api.fence = "2"
        replacement = Uploader(self.api, self.box, NEW_WORKER, now=lambda: self.api.now)
        self.assertTrue(replacement.upload_one())
        self.assertEqual([kind for kind, _ in self.api.calls][-3:], ["verify", "lease", "lookup"])
        self.assertEqual(len([kind for kind, _ in self.api.calls if kind == "capture"]), 1)
        self.assertEqual(self.box.pending_count(), 0)

    def test_unknown_under_new_fence_reenvelopes_same_slot_then_captures(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        prior = self.box.next_attempt(WORKER, "1")
        self.api.fence = "2"
        self.assertTrue(Uploader(self.api, self.box, NEW_WORKER, now=lambda: self.api.now).upload_one())
        self.assertEqual([kind for kind, _ in self.api.calls], ["verify", "lease", "lookup", "capture"])
        replacement = self.api.calls[-1][1]
        self.assertNotEqual(prior["operationId"], replacement["operationId"])
        self.assertEqual(prior["collection"], replacement["collection"])

    def test_no_new_fence_never_trusts_unknown_lookup(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        self.box.next_attempt(WORKER, "1")
        with self.assertRaises(ApiError):
            Uploader(self.api, self.box, NEW_WORKER, now=lambda: self.api.now).upload_one()
        self.assertNotIn("lookup", [kind for kind, _ in self.api.calls])
        self.assertEqual(self.box.pending_count(), 1)

    def test_auth_or_payload_conflict_never_acks_or_rewrites_pending_page(self):
        for code in ("INTEGRATION_ACCESS_DENIED", "OPERATION_CONFLICT", "COLLECTOR_REQUIRES_ATTENTION"):
            with self.subTest(code=code):
                self.api.error = ApiError(code)
                if self.box.pending_count() == 0:
                    self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
                with self.assertRaises(ApiError):
                    self.uploader.upload_one()
                self.assertEqual(self.box.pending_count(), 1)
        self.api.error = None

    def test_heartbeat_renews_after_thirty_seconds(self):
        self.uploader.ensure_lease()
        self.api.now += timedelta(seconds=29)
        self.uploader.ensure_lease()
        self.assertEqual(len(self.api.lease_results), 1)
        self.api.now += timedelta(seconds=1)
        self.uploader.ensure_lease()
        self.assertEqual(len(self.api.lease_results), 2)

    def test_backward_clock_forces_reverification_not_cached_lease_reuse(self):
        self.uploader.ensure_lease()
        self.api.now -= timedelta(seconds=60)
        self.uploader.ensure_lease()
        self.assertEqual(len([kind for kind, _ in self.api.calls if kind == "verify"]), 2)

    def test_outbox_v1_upgrade_preserves_pending_capture_and_attempt(self):
        self.box.enqueue(IDENTITY, CHECKPOINT, [[EVENT]])
        prior = self.box.next_attempt(WORKER, "1")
        self.box.db.execute("drop table lease_attempts")
        self.box.db.execute("pragma user_version=1")
        self.box.close()
        self.box = Outbox(self.path, Binding(OWNER, ACCOUNT, CONNECTION))
        self.assertEqual(self.box.db.execute("pragma user_version").fetchone()[0], 3)
        self.assertEqual(self.box.next_attempt(WORKER, "1"), prior)

    def test_backoff_is_jittered_exponential_and_capped(self):
        self.assertEqual(retry_delay(0, lambda: 0.5), 0.5)
        self.assertEqual(retry_delay(3, lambda: 1), 8)
        self.assertEqual(retry_delay(10_000, lambda: 1), 60)
        with self.assertRaises(ValueError):
            retry_delay(-1)


if __name__ == "__main__":
    unittest.main()

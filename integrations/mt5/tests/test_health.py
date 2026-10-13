import json
import threading
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import test_coordinator

from trade_os_mt5.health import local_health, observe
from trade_os_mt5.supervisor import SupervisorError


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coordinator.CoordinatorTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.worker = self.fixture.coordinator
        self.configuration = SimpleNamespace(path=self.worker.spool.parent / "connection.json", binding=self.worker.binding)
        self.path = self.worker.spool.parent / "collector-health.json"

    def read(self, now=None):
        return local_health(self.configuration, self.worker.worker_id, now=now or self.fixture.now)

    def test_lock_with_missing_tick_is_unknown_not_healthy(self):
        result = self.read()
        self.assertTrue(result["coordinatorActive"])
        self.assertTrue(result["localStale"])
        self.assertIsNone(result["observedState"])

    def test_recent_same_generation_tick_is_observation_not_server_contact(self):
        observe(self.worker)
        result = self.read()
        self.assertFalse(result["localStale"])
        self.assertEqual(result["observedState"], "PAUSED")
        self.assertTrue(self.worker.status()["stale"])
        self.assertEqual(self.fixture.calls, [])

    def test_dead_stale_future_and_old_generation_cannot_look_healthy(self):
        observe(self.worker)
        for seconds in (-1, 120, 121):
            self.assertTrue(self.read(self.fixture.now + timedelta(seconds=seconds))["localStale"])
        self.worker.box.start_generation(self.fixture.instant())
        self.assertTrue(local_health(self.configuration, self.worker.box.runtime()["worker_id"], now=self.fixture.now)["localStale"])
        self.worker.lock.close()
        self.assertFalse(self.read()["coordinatorActive"])
        self.assertTrue(self.read()["localStale"])

    def test_invalid_or_secret_bearing_observations_remain_unknown(self):
        observe(self.worker)
        valid = json.loads(self.path.read_text())
        for value in ({**valid, "workerId": "bad"}, {**valid, "version": True}, {**valid, "code": "secret text"},
                      {**valid, "accessToken": "fixture"}, {**valid, "connectionId": "other"}, {**valid, "state": "CONNECTED"}):
            self.path.write_text(json.dumps(value))
            self.assertTrue(self.read()["localStale"])
            self.assertIsNone(self.read()["observedAt"])
        self.path.write_text('{"version":1,"version":1}')
        self.assertTrue(self.read()["localStale"])

    def test_oversized_and_corrupt_records_are_unknown(self):
        for raw in ("a" * 8193, "[]", "not json"):
            self.path.write_text(raw)
            self.assertTrue(self.read()["localStale"])

    def test_retry_and_attention_record_only_redacted_codes(self):
        self.fixture.start()
        self.fixture.upload_error = SupervisorError("INTEGRATION_UNAVAILABLE", retryable=True)
        self.worker.tick()
        observe(self.worker)
        self.assertEqual(self.read()["observedState"], "RETRYING")
        self.assertEqual(self.read()["retryCode"], "INTEGRATION_UNAVAILABLE")
        self.worker.box.set_mode("ATTENTION", "Requires account attention", self.fixture.instant(), attention_code="ACCOUNT_MISMATCH")
        observe(self.worker)
        self.assertEqual(self.read()["observedState"], "ATTENTION")

    def test_failed_health_write_preserves_previous_observation_and_spool(self):
        observe(self.worker)
        before = self.path.read_bytes()
        with patch("trade_os_mt5.health.os.replace", side_effect=OSError("fixture failure")), self.assertRaises(OSError):
            observe(self.worker)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(list(self.path.parent.glob("health-*.tmp")))
        self.assertEqual(self.worker.box.runtime()["mode"], "PAUSED")

    def test_loop_writes_pause_and_retry_observations_without_broker_calls(self):
        stop = threading.Event()
        original = self.worker.tick
        def tick():
            result = original()
            stop.set()
            return result
        with patch.object(self.worker, "tick", side_effect=tick):
            self.worker.run_until_stopped(stop)
        self.assertEqual(self.read()["observedState"], "PAUSED")
        self.assertEqual(self.fixture.calls, [])

    def test_permission_error_is_not_interpreted_as_an_active_process(self):
        from trade_os_mt5.windows_security import CredentialError
        with patch("trade_os_mt5.health.SingleInstance", side_effect=CredentialError("CREDENTIAL_STORE_UNAVAILABLE")), self.assertRaises(CredentialError):
            self.read()


if __name__ == "__main__":
    unittest.main()

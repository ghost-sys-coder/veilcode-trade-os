import json
import subprocess
import sys
import unittest
from copy import deepcopy
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from test_broker import FakeTerminal
from test_outbox import ACCOUNT, CHECKPOINT, CONNECTION, EVENT, IDENTITY, OWNER, WORKER
from test_uploader import FakeApi

from trade_os_mt5.broker import BrokerError, ReadOnlyTerminal, TerminalBinding
from trade_os_mt5.oauth import OAuthConfiguration
from trade_os_mt5.outbox import Binding, Outbox, OutboxError
from trade_os_mt5.supervisor import (
    SupervisorError,
    _run_process,
    _worker_command,
    supervised_capture,
    supervised_upload,
)
from trade_os_mt5.windows_process import ProcessProtectionError
from trade_os_mt5.worker import perform


class ProcessBoundaryTests(unittest.TestCase):
    def test_hidden_coordinator_uses_sibling_console_worker_for_protocol(self):
        interpreter = Path(sys.executable).resolve()
        with patch("trade_os_mt5.supervisor.sys.executable", str(interpreter.with_name("pythonw.exe"))):
            command = _worker_command()
            result = _run_process(
                command[:1] + ["-c", "import json,sys; print(json.dumps(json.load(sys.stdin)))"],
                {"kind": "OK"},
                timeout=5,
            )
        self.assertEqual(Path(command[0]).name.lower(), "python.exe")
        self.assertEqual(result, {"kind": "OK"})

    def child(self, code, payload=None, timeout=5):
        return _run_process([sys.executable, "-c", code], payload or {}, timeout=timeout)

    def test_actual_owned_child_receives_stdin_and_returns_json(self):
        result = self.child("import json,sys; print(json.dumps(json.load(sys.stdin)))", {"kind": "OK", "value": 1})
        self.assertEqual(result, {"kind": "OK", "value": 1})

    def test_job_containment_failure_never_runs_worker_without_guard(self):
        with patch("trade_os_mt5.supervisor.OwnedWorkerJob", side_effect=ProcessProtectionError("SECRET")):
            with self.assertRaises(SupervisorError) as error:
                self.child("import sys,time; sys.stdin.read(); time.sleep(60)")
        self.assertEqual(error.exception.code, "WORKER_SUPERVISION_UNAVAILABLE")
        self.assertFalse(error.exception.retryable)

    def test_actual_stalled_child_is_killed_and_waited_not_left_alive(self):
        owned = []
        native = subprocess.Popen

        def start(*args, **kwargs):
            child = native(*args, **kwargs)
            owned.append(child)
            return child

        with patch("trade_os_mt5.supervisor.subprocess.Popen", side_effect=start):
            with self.assertRaises(SupervisorError) as error:
                self.child("import sys,time; sys.stdin.read(); time.sleep(60)", timeout=0.3)
        self.assertEqual(error.exception.code, "WORKER_STALLED")
        self.assertTrue(error.exception.retryable)
        self.assertIsNotNone(owned[0].poll())

    def test_interrupted_parent_also_terminates_its_owned_child(self):
        native = subprocess.Popen
        owned = []

        def start(*args, **kwargs):
            child = native(*args, **kwargs)
            original = child.wait

            def interrupt_once(*args, **kwargs):
                child.wait = original
                raise KeyboardInterrupt

            child.wait = interrupt_once
            owned.append(child)
            return child

        with patch("trade_os_mt5.supervisor.subprocess.Popen", side_effect=start):
            with self.assertRaises(KeyboardInterrupt):
                self.child("import sys,time; sys.stdin.read(); time.sleep(60)")
        self.assertIsNotNone(owned[0].poll())

    def test_bounded_stdout_kills_verbose_child_without_exposing_output(self):
        with self.assertRaises(SupervisorError) as error:
            self.child("import sys,time; sys.stdin.read(); print('SECRET'*10000,flush=True); time.sleep(60)")
        self.assertEqual(error.exception.code, "INVALID_WORKER_RESPONSE")
        self.assertNotIn("SECRET", str(error.exception))

    def test_crash_stderr_is_discarded_and_only_stable_code_is_returned(self):
        with self.assertRaises(SupervisorError) as error:
            self.child("import sys; sys.stdin.read(); sys.stderr.write('SECRET_TOKEN'); sys.exit(12)")
        self.assertEqual(error.exception.code, "WORKER_CRASHED")
        self.assertTrue(error.exception.retryable)
        self.assertNotIn("SECRET", str(error.exception))

    def test_duplicate_nonfinite_truncated_and_nondict_responses_rejected(self):
        for response in ('{"kind":"OK","kind":"ERROR"}', '{"value":NaN}', "{", "[]", "null", "SECRET_TOKEN"):
            with self.subTest(response=response), self.assertRaises(SupervisorError) as error:
                self.child("import sys; sys.stdin.read(); print(" + repr(response) + ")")
            self.assertEqual(error.exception.code, "INVALID_WORKER_RESPONSE")

    def test_only_known_error_codes_are_retryable_and_extra_fields_rejected(self):
        for code, expected, retryable in (
            ("INTEGRATION_UNAVAILABLE", "INTEGRATION_UNAVAILABLE", True),
            ("MT5_ACCOUNT_IDENTITY_MISMATCH", "MT5_ACCOUNT_IDENTITY_MISMATCH", False),
            ("SECRET_TOKEN", "WORKER_REQUIRES_ATTENTION", False),
        ):
            with self.subTest(code=code), self.assertRaises(SupervisorError) as error:
                self.child(
                    "import sys; sys.stdin.read(); print(" + repr(json.dumps({"kind": "ERROR", "code": code})) + ")"
                )
            self.assertEqual(error.exception.code, expected)
            self.assertEqual(error.exception.retryable, retryable)
        with self.assertRaises(SupervisorError) as error:
            self.child(
                'import sys; sys.stdin.read(); print(\'{"kind":"ERROR","code":"INTEGRATION_UNAVAILABLE","raw":"SECRET"}\')'
            )
        self.assertEqual(error.exception.code, "INVALID_WORKER_RESPONSE")

    def test_invalid_input_or_deadline_does_not_launch_a_child(self):
        with patch("trade_os_mt5.supervisor.subprocess.Popen") as start:
            for payload, timeout in (
                ({}, True),
                ({}, float("nan")),
                ({}, 121),
                ([], 5),
                ({"x": "x" * 32768}, 5),
                ({"x": float("nan")}, 5),
            ):
                with self.subTest(timeout=timeout), self.assertRaises(SupervisorError) as error:
                    _run_process([sys.executable], payload, timeout=timeout)
                self.assertEqual(error.exception.code, "INVALID_WORKER_CONFIGURATION")
            start.assert_not_called()

    def test_kill_after_durable_commit_preserves_frozen_capture_on_restart(self):
        with TemporaryDirectory(prefix="trade-os-stall-test-") as temporary:
            path = Path(temporary) / "outbox.sqlite3"
            code = """import json,sys,time
from pathlib import Path
from trade_os_mt5.outbox import Binding,Outbox
p=json.load(sys.stdin)
box=Outbox(Path(p['path']),Binding(**p['binding']))
box.enqueue(p['identity'],p['checkpoint'],[[p['event']]])
print('{}',flush=True)
time.sleep(60)
"""
            with self.assertRaises(SupervisorError) as error:
                self.child(
                    code,
                    {
                        "path": str(path),
                        "binding": asdict(Binding(OWNER, ACCOUNT, CONNECTION)),
                        "identity": IDENTITY,
                        "checkpoint": CHECKPOINT,
                        "event": EVENT,
                    },
                    timeout=1.5,
                )
            self.assertEqual(error.exception.code, "WORKER_STALLED")
            box = Outbox(path, Binding(OWNER, ACCOUNT, CONNECTION))
            try:
                self.assertEqual(box.pending_count(), 1)
                self.assertEqual(box.checkpoints(), (CHECKPOINT, None))
                self.assertEqual(box.next_attempt(WORKER, "1")["events"], [EVENT])
                self.assertEqual(box.db.execute("pragma quick_check").fetchone()[0], "ok")
            finally:
                box.close()

    def test_actual_fixed_worker_redacts_invalid_or_oversize_stdin(self):
        for data in (b'{"action":"UNKNOWN","secret":"SECRET"}', b"[]", b" " * 32769, b'{"action":NaN}'):
            result = subprocess.run(
                [sys.executable, "-m", "trade_os_mt5.worker"],
                input=data,
                capture_output=True,
                timeout=5,
                check=True,
            )
            self.assertEqual(json.loads(result.stdout), {"kind": "ERROR", "code": "WORKER_REQUIRES_ATTENTION"})
            self.assertEqual(result.stderr, b"")


class WorkerWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-worker-test-")
        self.root = Path(self.temp.name)
        self.spool = self.root / CONNECTION / "outbox.sqlite3"
        self.spool.parent.mkdir()
        self.executable = self.root / "terminal64.exe"
        self.executable.touch()
        self.data = self.root / "data"
        self.data.mkdir()
        self.binding = Binding(OWNER, ACCOUNT, CONNECTION)
        self.terminal = TerminalBinding(self.executable, self.data, dict(IDENTITY), True)
        self.native = FakeTerminal(self.executable, self.data)
        self.configuration = OAuthConfiguration(
            "https://example.supabase.co/auth/v1", "https://trade.example", OWNER, ACCOUNT, WORKER
        )
        self.payload = {
            "action": "CAPTURE",
            "binding": asdict(self.binding),
            "spool": str(self.spool),
            "terminal": {
                "executable": str(self.executable),
                "dataPath": str(self.data),
                "identity": dict(IDENTITY),
                "dedicatedApproved": True,
                "portable": False,
            },
            "checkpoint": None,
            "fullHistory": False,
        }

    def tearDown(self):
        self.temp.cleanup()

    def reader(self, binding):
        return ReadOnlyTerminal(binding, module=self.native)

    def test_capture_commits_whole_snapshot_before_success_reply(self):
        with patch("trade_os_mt5.worker.ReadOnlyTerminal", side_effect=self.reader):
            result = perform(self.payload)
        box = Outbox(self.spool, self.binding)
        try:
            self.assertEqual(result["kind"], "CAPTURED")
            self.assertEqual(result["connectionId"], CONNECTION)
            self.assertEqual(box.checkpoints(), (result["checkpoint"], None))
            self.assertEqual(box.pending_count(), result["pendingPages"])
            request = box.next_attempt(WORKER, "1")
            self.assertEqual(request["collection"]["id"], result["collectionId"])
            self.assertEqual([event["kind"] for event in request["events"]], ["DEAL", "ORDER", "POSITION", "ACCOUNT"])
        finally:
            box.close()
        self.assertEqual(self.native.calls[-1][0], "shutdown")

    def test_account_switch_during_capture_leaves_cursor_and_pending_empty(self):
        self.native.after["positions"] = lambda: setattr(self.native.account, "login", 999)
        with patch("trade_os_mt5.worker.ReadOnlyTerminal", side_effect=self.reader):
            with self.assertRaises(BrokerError) as error:
                perform(self.payload)
        self.assertEqual(error.exception.code, "MT5_ACCOUNT_IDENTITY_MISMATCH")
        box = Outbox(self.spool, self.binding)
        try:
            self.assertEqual(box.checkpoints(), (None, None))
            self.assertEqual(box.pending_count(), 0)
        finally:
            box.close()
        self.assertEqual(self.native.calls[-1][0], "shutdown")

    def test_invalid_or_unapproved_configuration_never_creates_spool_or_connects(self):
        cases = []
        for key, value in (
            ("checkpoint", "yesterday"),
            ("fullHistory", 1),
            ("unexpected", "SECRET"),
            ("action", "EXECUTE"),
        ):
            payload = deepcopy(self.payload)
            payload[key] = value
            cases.append(payload)
        payload = deepcopy(self.payload)
        payload["terminal"]["dedicatedApproved"] = False
        cases.append(payload)
        for payload in cases:
            with self.subTest(key=payload.keys()), self.assertRaises((ValueError, BrokerError, OutboxError)):
                perform(payload)
        self.assertFalse(self.spool.exists())
        self.assertEqual(self.native.calls, [])

    def test_upload_checks_live_authorization_and_fence_even_when_idle(self):
        api = FakeApi()
        api.now = datetime.now(UTC)
        payload = {
            "action": "UPLOAD",
            "binding": asdict(self.binding),
            "spool": str(self.spool),
            "oauth": asdict(self.configuration),
            "workerId": WORKER,
        }
        with patch("trade_os_mt5.worker.OAuthClient"), patch("trade_os_mt5.worker.IntegrationApi", return_value=api):
            result = perform(payload)
        self.assertEqual([call[0] for call in api.calls], ["verify", "lease"])
        self.assertEqual(
            result,
            {
                "kind": "UPLOADED",
                "connectionId": CONNECTION,
                "pendingPages": 0,
                "captureCheckpoint": None,
                "serverCheckpoint": None,
                "leaseExpiresAt": (api.now + timedelta(seconds=120))
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
            },
        )

    def test_public_capture_uses_only_fixed_module_and_validates_result_boundaries(self):
        response = {
            "kind": "CAPTURED",
            "connectionId": CONNECTION,
            "collectionId": WORKER,
            "checkpoint": CHECKPOINT,
            "pendingPages": 1,
        }
        with patch("trade_os_mt5.supervisor._run_process", return_value=response) as run:
            self.assertEqual(supervised_capture(self.binding, self.terminal, self.spool), response)
            self.assertEqual(run.call_args.args[0], [sys.executable, "-m", "trade_os_mt5.worker"])
        for key, value in (
            ("checkpoint", "bad"),
            ("collectionId", "bad"),
            ("pendingPages", True),
            ("connectionId", ACCOUNT),
        ):
            with patch("trade_os_mt5.supervisor._run_process", return_value={**response, key: value}):
                with self.subTest(key=key), self.assertRaises(SupervisorError) as error:
                    supervised_capture(self.binding, self.terminal, self.spool)
                self.assertEqual(error.exception.code, "INVALID_WORKER_RESPONSE")

    def test_public_upload_validates_timestamps_and_scoped_mapping(self):
        response = {
            "kind": "UPLOADED",
            "connectionId": CONNECTION,
            "pendingPages": 0,
            "captureCheckpoint": CHECKPOINT,
            "serverCheckpoint": None,
            "leaseExpiresAt": CHECKPOINT,
        }
        with patch("trade_os_mt5.supervisor._run_process", return_value=response) as run:
            self.assertEqual(supervised_upload(self.binding, self.configuration, self.spool, WORKER), response)
            self.assertEqual(run.call_args.args[0], [sys.executable, "-m", "trade_os_mt5.worker"])
        with patch("trade_os_mt5.supervisor._run_process", return_value={**response, "serverCheckpoint": "bad"}):
            with self.assertRaises(SupervisorError):
                supervised_upload(self.binding, self.configuration, self.spool, WORKER)
        with patch("trade_os_mt5.supervisor._run_process") as run:
            with self.assertRaises(SupervisorError):
                supervised_upload(Binding(ACCOUNT, OWNER, CONNECTION), self.configuration, self.spool, WORKER)
            run.assert_not_called()

    def test_spool_cannot_be_retargeted_to_another_connection_directory(self):
        with patch("trade_os_mt5.supervisor._run_process") as run:
            for path in (Path("outbox.sqlite3"), self.root / "outbox.sqlite3", self.root / ACCOUNT / "outbox.sqlite3"):
                with self.subTest(path=path), self.assertRaises(SupervisorError):
                    supervised_capture(self.binding, self.terminal, path)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()

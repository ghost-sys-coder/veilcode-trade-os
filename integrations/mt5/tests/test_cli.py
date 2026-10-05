import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from test_outbox import ACCOUNT, CONNECTION, IDENTITY, OWNER, WORKER

from trade_os_mt5.api import ApiError
from trade_os_mt5.cli import load_configuration, main, perform, status
from trade_os_mt5.outbox import Outbox
from trade_os_mt5.windows_security import CredentialError


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-operator-test-")
        root = Path(self.temp.name)
        self.path = root / CONNECTION / "connection.json"
        self.path.parent.mkdir()
        executable, data = root / "terminal64.exe", root / "data"
        executable.touch()
        data.mkdir()
        self.value = {
            "version": 1,
            "binding": {"ownerId": OWNER, "accountId": ACCOUNT, "connectionId": CONNECTION},
            "oauth": {
                "issuer": "https://fixture.supabase.co/auth/v1",
                "applicationOrigin": "https://trade.example",
                "clientId": WORKER,
                "allowLocalHttp": False,
            },
            "terminal": {
                "executable": str(executable),
                "dataPath": str(data),
                "identity": dict(IDENTITY),
                "dedicatedApproved": True,
                "portable": False,
            },
            "callbackUri": "http://127.0.0.1:9876/callback",
        }
        self.write()

    def write(self, raw=None):
        self.path.write_text(raw if raw is not None else json.dumps(self.value), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_init_is_explicit_paused_and_never_initializes_broker(self):
        configuration = load_configuration(self.path)
        with patch("trade_os_mt5.broker.ReadOnlyTerminal.connect") as connect:
            result = perform("init", configuration)
        self.assertEqual(result["mode"], "PAUSED")
        self.assertEqual(result["pendingPages"], 0)
        connect.assert_not_called()

    def test_inspection_of_missing_spool_does_not_create_database(self):
        configuration = load_configuration(self.path)
        with self.assertRaisesRegex(CredentialError, "COLLECTOR_NOT_INITIALIZED"):
            status(configuration)
        self.assertFalse(configuration.spool.exists())

    def test_control_has_reason_history_and_resume_checks_live_grant(self):
        configuration = load_configuration(self.path)
        perform("init", configuration)
        with patch("trade_os_mt5.cli.OAuthClient"), patch("trade_os_mt5.cli.IntegrationApi.verify_account") as verify:
            self.assertEqual(
                perform("resume", configuration, reason="Operator approved demo capture")["mode"], "RUNNING"
            )
            verify.assert_called_once_with(OWNER, ACCOUNT, client_id=WORKER)
        self.assertEqual(perform("pause", configuration, reason="Operator paused for maintenance")["mode"], "PAUSED")
        box = Outbox(configuration.spool, configuration.binding)
        try:
            self.assertEqual(box.db.execute("select count(*) from collector_control_events").fetchone()[0], 2)
        finally:
            box.close()

    def test_revoked_grant_cannot_resume_and_initialization_does_not_clear_attention(self):
        configuration = load_configuration(self.path)
        perform("init", configuration)
        box = Outbox(configuration.spool, configuration.binding)
        try:
            box.set_mode(
                "ATTENTION",
                "ACCOUNT_REQUIRES_ATTENTION",
                "2026-01-01T00:00:00.000Z",
                attention_code="ACCOUNT_REQUIRES_ATTENTION",
            )
        finally:
            box.close()
        with (
            patch("trade_os_mt5.cli.OAuthClient"),
            patch("trade_os_mt5.cli.IntegrationApi.verify_account", side_effect=ApiError("INTEGRATION_ACCESS_DENIED")),
        ):
            with self.assertRaises(ApiError):
                perform("resume", configuration, reason="Operator requested resumed demo")
        self.assertEqual(perform("init", configuration)["mode"], "ATTENTION")

    def test_unknown_keys_tokens_bad_identity_and_unapproved_terminal_are_rejected(self):
        original = json.dumps(self.value)
        for change in (
            lambda value: value.update(accessToken="synthetic"),
            lambda value: value["binding"].update(connectionId=WORKER),
            lambda value: value["terminal"].update(dedicatedApproved=False),
            lambda value: value["terminal"]["identity"].update(accountKind="LIVE"),
            lambda value: value["oauth"].update(allowLocalHttp="false"),
            lambda value: value.update(callbackUri="http://localhost:9876/callback"),
            lambda value: value.update(version=True),
        ):
            self.value = json.loads(original)
            change(self.value)
            self.write()
            with self.assertRaisesRegex(CredentialError, "INVALID_OPERATOR_CONFIGURATION"):
                load_configuration(self.path)

    def test_duplicate_json_and_large_config_rejected(self):
        for raw in ('{"version":1,"version":1}', "x" * 16385, '{"version":NaN}'):
            self.write(raw)
            with self.assertRaises(CredentialError):
                load_configuration(self.path)

    def test_short_reason_cannot_change_durable_mode(self):
        configuration = load_configuration(self.path)
        perform("init", configuration)
        with self.assertRaisesRegex(CredentialError, "CONTROL_REASON_REQUIRED"):
            perform("resume", configuration, reason="  x  ")
        self.assertEqual(status(configuration)["mode"], "PAUSED")

    def test_cli_errors_are_redacted_and_exit_nonzero(self):
        self.value["refreshToken"] = "SECRET_SYNTHETIC_FIXTURE"
        self.write()
        out, error = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(error):
            result = main(["status", "--config", str(self.path)])
        self.assertEqual(result, 1)
        self.assertEqual(out.getvalue(), "")
        self.assertNotIn("SECRET_SYNTHETIC_FIXTURE", error.getvalue())
        self.assertEqual(json.loads(error.getvalue())["code"], "INVALID_OPERATOR_CONFIGURATION")

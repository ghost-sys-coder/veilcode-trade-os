import copy
import json
import os
import unittest
from contextlib import closing
from unittest.mock import Mock, patch

import test_pairing
from test_setup import ID, mt5
from trade_os_companion.controls import control, launch, mapped, remember, snapshot, verified
from trade_os_companion.pairing import probe, write_new
from trade_os_companion.setup import Profiles, SetupError, bootstrap
from trade_os_mt5.cli import load_configuration, perform
from trade_os_mt5.outbox import Outbox
from trade_os_mt5.windows_security import CredentialError, SingleInstance

CONNECTION = test_pairing.CONNECTION

class ControlsTests(unittest.TestCase):
    def setUp(self):
        fixture = test_pairing.PairingTests()
        fixture.setUp()
        self.addCleanup(fixture.temporary.cleanup)
        self.fixture = fixture
        self.profiles = Profiles(fixture.root / "profiles")
        source = fixture.root / "public.json"
        source.write_text(json.dumps(mt5()))
        self.profiles.import_file(source)
        self.proposal = probe(fixture.profile, str(fixture.executable), False, module=fixture.module)
        self.manifest = {"version": 1, "binding": {"ownerId": fixture.profile["ownerId"], "accountId": fixture.profile["accountId"], "connectionId": CONNECTION},
                         "oauth": {key: mt5()["oauth"][key] for key in ("issuer", "applicationOrigin", "clientId", "allowLocalHttp")},
                         "terminal": self.proposal["terminal"], "callbackUri": mt5()["oauth"]["callbackUri"]}
        self.path = fixture.root / CONNECTION / "connection.json"
        write_new(self.path, self.manifest)
        self.configuration = load_configuration(self.path)
        perform("init", self.configuration)
        remember(self.profiles, ID, self.path)

    def test_receipt_reopens_same_mapping_and_identical_replay(self):
        remember(self.profiles, ID, self.path)
        self.assertEqual(mapped(self.profiles, ID)[1], self.configuration)
        self.assertEqual(control(self.profiles, ID, "HEALTH")["mode"], "PAUSED")

    def test_retargeted_or_changed_manifest_is_rejected_before_any_control(self):
        for field in ("binding", "oauth", "terminal"):
            with self.subTest(field=field):
                altered = copy.deepcopy(self.manifest)
                if field == "binding":
                    altered[field]["ownerId"] = "99999999-9999-4999-8999-999999999999"
                elif field == "oauth":
                    altered[field]["clientId"] = "99999999-9999-4999-8999-999999999999"
                else:
                    altered[field]["identity"]["login"] = "999"
                self.path.write_text(json.dumps(altered))
                with self.assertRaises(SetupError):
                    control(self.profiles, ID, "PAUSE", reason="Safety pause requested")
                self.path.write_text(json.dumps(self.manifest, sort_keys=True, separators=(",", ":")) + "\n")

    def test_mcp_profile_cannot_operate_collector(self):
        profiles = Mock()
        profiles.read.return_value = {"purpose": "MCP"}
        with self.assertRaisesRegex(SetupError, "INVALID_ACTION"):
            control(profiles, ID, "START", reason="Explicit demo collection")

    def test_unapproved_unknown_missing_reason_no_side_effects(self):
        with patch("trade_os_companion.controls.verified") as verify, patch("trade_os_companion.controls.launch") as start:
            for command, why in (("EXECUTE", "Long enough reason"), ("START", None), ("PAUSE", "short"), ("INSTALL_STARTUP", True)):
                with self.assertRaises(SetupError):
                    control(self.profiles, ID, command, reason=why)
            verify.assert_not_called()
            start.assert_not_called()
        self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")

    def test_offline_pause_preserves_pending_pages_and_records_reason(self):
        with closing(Outbox(self.configuration.spool, self.configuration.binding)) as box:
            box.enqueue(self.proposal["terminal"]["identity"], "2026-10-13T00:00:00.000Z", [[]])
            before = box.checkpoints()
        with patch("trade_os_companion.controls.verified", side_effect=AssertionError("No network for pause")):
            result = control(self.profiles, ID, "PAUSE", reason="User explicitly requests pause")
        self.assertEqual(result["pendingPages"], 1)
        self.assertEqual(result["mode"], "PAUSED")
        with closing(Outbox(self.configuration.spool, self.configuration.binding)) as box:
            self.assertEqual(box.checkpoints(), before)
            self.assertEqual(box.db.execute("select reason from collector_control_events order by sequence desc limit 1").fetchone()[0], "User explicitly requests pause")

    def test_revoked_mapping_never_resumes_or_launches(self):
        with patch("trade_os_companion.controls.verified", side_effect=SetupError("INVALID_PAIRING")), patch("trade_os_companion.controls.launch") as start:
            with self.assertRaises(SetupError):
                control(self.profiles, ID, "START", reason="Explicit demo collection")
            start.assert_not_called()
        self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")

    def test_failed_or_uncertain_launch_rolls_back_to_paused(self):
        with (patch("trade_os_companion.controls.verified"), patch("trade_os_mt5.cli.IntegrationApi"), patch("trade_os_mt5.cli.OAuthClient"),
              patch("trade_os_companion.controls.launch", side_effect=SetupError("WORKER_START_REQUIRES_INSPECTION"))):
            with self.assertRaises(SetupError):
                control(self.profiles, ID, "START", reason="Explicit demo collection")
        self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")

    def test_existing_stalled_lock_is_not_force_restarted(self):
        with SingleInstance(self.path.parent / "collector.lock"), patch("trade_os_companion.controls.verified"), patch("trade_os_companion.controls.launch") as start:
            with self.assertRaisesRegex(SetupError, "WORKER_STALLED_REQUIRES_INSPECTION"):
                control(self.profiles, ID, "START", reason="Explicit demo collection")
            start.assert_not_called()
        self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")

    def test_verified_start_uses_existing_workflows_no_startup_install(self):
        with (patch("trade_os_companion.controls.verified") as verify, patch("trade_os_mt5.cli.IntegrationApi"), patch("trade_os_mt5.cli.OAuthClient"),
              patch("trade_os_companion.controls.launch") as start, patch("trade_os_mt5.cli.install_startup") as install):
            result = control(self.profiles, ID, "START", reason="Explicit demo collection")
            self.assertEqual(result["mode"], "RUNNING")
            verify.assert_called_once()
            start.assert_called_once_with(self.configuration)
            install.assert_not_called()

    def test_server_approval_connection_and_terminal_must_match(self):
        api = Mock()
        for approval in ({}, {"connectionId": CONNECTION, "proposal": {"terminal": {}}}):
            api._request.return_value = approval
            with patch("trade_os_companion.controls.client_api", return_value=api), self.assertRaises(SetupError):
                verified(bootstrap(mt5()), self.configuration)
        api._request.return_value = {"connectionId": CONNECTION, "proposal": self.proposal}
        with patch("trade_os_companion.controls.client_api", return_value=api):
            verified(bootstrap(mt5()), self.configuration)

    def test_startup_is_separate_requires_paused_and_never_launches(self):
        with (patch("trade_os_companion.controls.verified"), patch("trade_os_mt5.cli.install_startup", return_value={"installed": True}) as install,
              patch("trade_os_companion.controls.launch") as start):
            self.assertTrue(control(self.profiles, ID, "INSTALL_STARTUP", reason="Opt into current-user startup")["installed"])
            install.assert_called_once_with(self.configuration)
            start.assert_not_called()
            self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")
        records = [json.loads(path.read_text()) for path in (self.profiles._directory(ID) / "control-audit").glob("*.json")]
        self.assertEqual({record["state"] for record in records}, {"REQUESTED", "COMPLETED"})
        self.assertEqual(len({record["operationId"] for record in records}), 1)
        self.assertTrue(all(record["reason"] == "Opt into current-user startup" for record in records))
        with closing(Outbox(self.configuration.spool, self.configuration.binding)) as box:
            box.set_mode("RUNNING", "Fixture intent only not an actual collector", "2026-10-13T00:00:00.000Z")
        with patch("trade_os_companion.controls.verified"), self.assertRaisesRegex(SetupError, "PAUSE_BEFORE_STARTUP_CHANGE"):
            control(self.profiles, ID, "REPAIR_STARTUP", reason="Explicit owned startup repair")

    def test_disable_requires_owned_task_before_pause_and_is_offline(self):
        with (patch("trade_os_companion.controls.inspect", side_effect=CredentialError("STARTUP_REPAIR_REJECTED")),
              patch("trade_os_companion.controls.set_enabled") as disable):
            with self.assertRaises(CredentialError):
                control(self.profiles, ID, "DISABLE_STARTUP", reason="Explicitly opt out of startup")
            disable.assert_not_called()
        with (patch("trade_os_companion.controls.inspect"), patch("trade_os_companion.controls.set_enabled", return_value={"state": "DISABLED"}) as disable,
              patch("trade_os_companion.controls.verified", side_effect=AssertionError("No network"))):
            self.assertEqual(control(self.profiles, ID, "DISABLE_STARTUP", reason="Explicitly opt out of startup")["state"], "DISABLED")
            disable.assert_called_once_with(self.configuration, False)
        self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")

    def test_launch_fixed_hidden_bundled_interpreter_no_shell_or_environment_injection(self):
        good = {"coordinatorActive": True, "localStale": False}
        with (patch("trade_os_companion.controls.snapshot", return_value=good), patch("trade_os_companion.controls.subprocess.Popen") as process,
              patch.dict(os.environ, {"NODE_OPTIONS": "hostile", "PYTHONPATH": "hostile", "SUPABASE_SECRET_KEY": "fixture-only"})):
            launch(self.configuration)
        args, options = process.call_args.args[0], process.call_args.kwargs
        self.assertTrue(args[0].endswith("pythonw.exe"))
        self.assertEqual(args[1:], ["-I", "-m", "trade_os_mt5.cli", "run", "--config", str(self.path)])
        self.assertNotIn("shell", options)
        self.assertFalse({"NODE_OPTIONS", "PYTHONPATH", "SUPABASE_SECRET_KEY"}.intersection(options["env"]))
        self.assertTrue(options["close_fds"])

    def test_uncertain_startup_change_preserves_intent_audit_without_retry(self):
        with patch("trade_os_companion.controls.verified"), patch("trade_os_mt5.cli.install_startup", side_effect=CredentialError("STARTUP_REGISTRATION_REQUIRES_INSPECTION")) as install:
            with self.assertRaises(CredentialError):
                control(self.profiles, ID, "INSTALL_STARTUP", reason="Opt into current-user startup")
            install.assert_called_once()
        records = [json.loads(path.read_text()) for path in (self.profiles._directory(ID) / "control-audit").glob("*.json")]
        self.assertEqual({record["state"] for record in records}, {"REQUESTED", "UNCONFIRMED"})
        self.assertEqual(snapshot(self.configuration)["mode"], "PAUSED")


if __name__ == "__main__":
    unittest.main()

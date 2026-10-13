import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from test_setup import ID, bootstrap, mt5
from trade_os_companion.pairing import activate, probe, write_new
from trade_os_companion.setup import Profiles, SetupError
from trade_os_mt5.broker import BrokerError
from trade_os_mt5.cli import load_configuration, perform

CONNECTION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.executable = self.root / "terminal64.exe"
        self.executable.write_bytes(b"fixture-only-never-executed")
        self.data = self.root / "data"
        self.data.mkdir()
        self.account = SimpleNamespace(server="Demo", login=123456, currency="USD", currency_digits=2, trade_mode=0, margin_mode=2)
        self.module = Mock()
        self.module.ACCOUNT_TRADE_MODE_DEMO = 0
        self.module.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING = 2
        self.module.ACCOUNT_MARGIN_MODE_RETAIL_NETTING = 0
        self.module.initialize.return_value = True
        self.module.terminal_info.return_value = SimpleNamespace(path=str(self.root), data_path=str(self.data), connected=True)
        self.module.account_info.return_value = self.account
        self.profile = bootstrap(mt5())

    def test_exact_path_demo_metadata_only_and_deterministic_marker(self):
        first = probe(self.profile, str(self.executable), False, module=self.module)
        second = probe(self.profile, str(self.executable), False, module=self.module)
        self.assertEqual(first["terminal"]["identity"], second["terminal"]["identity"])
        self.assertEqual(first["terminal"]["identity"]["login"], "123456")
        self.assertNotIn("balance", first)
        self.module.initialize.assert_called_with(str(self.executable.resolve()), timeout=15000, portable=False)
        self.module.login.assert_not_called()
        self.module.order_send.assert_not_called()
        self.module.history_deals_get.assert_not_called()
        self.module.shutdown.assert_called()

    def test_live_wrong_precision_and_unknown_mode_rejected(self):
        for change in ({"trade_mode": 1}, {"currency_digits": 3}, {"margin_mode": 99}, {"currency": "GBP"}, {"login": 1.5}):
            with self.subTest(change=change):
                account = copy.copy(self.account)
                for field, value in change.items():
                    setattr(account, field, value)
                self.module.account_info.return_value = account
                with self.assertRaises(BrokerError):
                    probe(self.profile, str(self.executable), False, module=self.module)

    def test_account_switch_or_terminal_switch_during_probe_rejected(self):
        switched = copy.copy(self.account)
        switched.login = 99
        self.module.account_info.side_effect = [self.account, switched]
        with self.assertRaises(BrokerError):
            probe(self.profile, str(self.executable), False, module=self.module)
        self.module.account_info.side_effect = None
        self.module.terminal_info.return_value.path = str(self.data)
        with self.assertRaises(BrokerError):
            probe(self.profile, str(self.executable), False, module=self.module)

    def test_invalid_selection_and_mcp_never_initialize(self):
        with self.assertRaises(SetupError):
            probe(self.profile, str(self.root / "wrong.exe"), False, module=self.module)
        self.module.initialize.assert_not_called()

    def test_server_verified_activation_creates_only_paused_spool_and_replays(self):
        profiles = Profiles(self.root / "profiles")
        source = self.root / "bootstrap.json"
        source.write_text(json.dumps(mt5()))
        profiles.import_file(source)
        proposal = probe(self.profile, str(self.executable), False, module=self.module)
        directory = profiles._directory(ID)
        path = directory / "pairing-fixture.json"
        write_new(path, proposal)
        write_new(directory / "pairing-fixture.local.json", {"existingManifest": None, "previousHash": None})
        manifest = {"version": 1, "binding": {"ownerId": self.profile["ownerId"], "accountId": self.profile["accountId"], "connectionId": CONNECTION},
                    "oauth": {key: mt5()["oauth"][key] for key in ("issuer", "applicationOrigin", "clientId", "allowLocalHttp")},
                    "terminal": proposal["terminal"], "callbackUri": mt5()["oauth"]["callbackUri"]}
        mapped = self.root / "mapped.json"
        mapped.write_text(json.dumps(manifest))
        api = Mock()
        api._request.return_value = {"proposal": proposal, "connectionId": CONNECTION}
        with patch("trade_os_companion.pairing.client_api", return_value=api), patch("trade_os_companion.pairing.probe", return_value=proposal):
            first = activate(profiles, ID, str(path), str(mapped))
            self.assertEqual(first["state"], "PAUSED")
            self.assertEqual(first["pendingPages"], 0)
            self.assertEqual(first, activate(profiles, ID, str(path), str(mapped)))
            manifest["terminal"] = dict(manifest["terminal"], executable=str(self.data / "terminal64.exe"))
            mapped.write_text(json.dumps(manifest))
            with self.assertRaises(SetupError):
                activate(profiles, ID, str(path), str(mapped))

    def test_adoption_preserves_paused_spool_and_rejects_manifest_changes(self):
        profiles = Profiles(self.root / "profiles")
        source = self.root / "bootstrap.json"
        source.write_text(json.dumps(mt5()))
        profiles.import_file(source)
        proposal = probe(self.profile, str(self.executable), False, module=self.module)
        proposal["existingConnectionId"] = CONNECTION
        old_path = self.root / CONNECTION / "connection.json"
        old = {"version": 1, "binding": {"ownerId": self.profile["ownerId"], "accountId": self.profile["accountId"], "connectionId": CONNECTION},
               "oauth": {key: mt5()["oauth"][key] for key in ("issuer", "applicationOrigin", "clientId", "allowLocalHttp")},
               "terminal": proposal["terminal"], "callbackUri": mt5()["oauth"]["callbackUri"]}
        old["oauth"]["clientId"] = "99999999-9999-4999-8999-999999999999"
        write_new(old_path, old)
        perform("init", load_configuration(old_path))
        spool = old_path.parent / "outbox.sqlite3"
        with closing(sqlite3.connect(spool)) as database:
            before = list(database.iterdump())
        path = profiles._directory(ID) / "pairing-adopt.json"
        write_new(path, proposal)
        write_new(path.with_name("pairing-adopt.local.json"), {"existingManifest": str(old_path), "previousHash": hashlib.sha256(old_path.read_bytes()).hexdigest()})
        manifest = copy.deepcopy(old)
        manifest["oauth"]["clientId"] = self.profile["clientId"]
        mapped = self.root / "approved.json"
        mapped.write_text(json.dumps(manifest))
        api = Mock()
        api._request.return_value = {"proposal": proposal, "connectionId": CONNECTION}
        with patch("trade_os_companion.pairing.client_api", return_value=api), patch("trade_os_companion.pairing.probe", return_value=proposal):
            first = activate(profiles, ID, str(path), str(mapped))
            self.assertEqual(first["state"], "PAUSED")
            self.assertEqual(first, activate(profiles, ID, str(path), str(mapped)))
        with closing(sqlite3.connect(spool)) as database:
            self.assertEqual(list(database.iterdump()), before)
        changed = copy.deepcopy(manifest)
        changed["oauth"]["clientId"] = "88888888-8888-4888-8888-888888888888"
        old_path.write_text(json.dumps(changed))
        with patch("trade_os_companion.pairing.client_api", return_value=api), patch("trade_os_companion.pairing.probe", return_value=proposal):
            with self.assertRaisesRegex(SetupError, "PROFILE_CONFLICT"):
                activate(profiles, ID, str(path), str(mapped))


if __name__ == "__main__":
    unittest.main()

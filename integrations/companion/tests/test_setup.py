import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from trade_os_companion.setup import ISSUER, Profiles, SetupError, bootstrap, load_public_file, local_path

ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
ACCOUNT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def mcp():
    return {"version": 1, "profile": "tradeos-" + ID, "resource": "https://mcp-preview.veilcode.studio/mcp",
            "issuer": ISSUER, "clientId": CLIENT, "redirectUri": "http://127.0.0.1:9878/callback", "allowLoopback": False}


def mt5():
    return {"format": "trade-os-setup", "version": 1, "purpose": "MT5", "profileId": ID, "ownerId": OWNER,
            "account": {"id": ACCOUNT, "name": "USD demo", "currencyCode": "USD", "currencyPrecision": 2},
            "oauth": {"issuer": ISSUER, "applicationOrigin": "https://tradeos.veilcode.studio", "clientId": CLIENT,
                      "callbackUri": "http://127.0.0.1:9876/callback", "allowLocalHttp": False}}


class BootstrapTests(unittest.TestCase):
    def test_app_generated_mcp_profile(self):
        self.assertEqual(bootstrap(mcp())["profileId"], ID)
        self.assertEqual(bootstrap(mcp())["clientKind"], "CODEX")

    def test_all_registered_local_mcp_ports(self):
        for port, kind in ((9878, "CODEX"), (9880, "CLAUDE_CODE"), (9882, "GEMINI_CLI"), (9884, "CLAUDE_DESKTOP")):
            value = mcp() | {"redirectUri": f"http://127.0.0.1:{port}/callback"}
            self.assertEqual(bootstrap(value)["clientKind"], kind)

    def test_mt5_is_configuration_not_a_mapping(self):
        checked = bootstrap(mt5())
        self.assertEqual(checked["ownerId"], OWNER)
        self.assertEqual(checked["accountId"], ACCOUNT)
        self.assertNotIn("connectionId", checked)
        self.assertNotIn("terminal", checked)

    def test_currency_precision_is_preserved(self):
        for precision in (0, 2, 3, 20):
            value = mt5()
            value["account"]["currencyPrecision"] = precision
            self.assertEqual(bootstrap(value)["configuration"]["account"]["currencyPrecision"], precision)

    def test_untrusted_endpoints(self):
        for field, bad in (("issuer", "https://evil.example/auth/v1"), ("resource", "https://evil.example/mcp"),
                           ("resource", "https://mcp-preview.veilcode.studio.evil.example/mcp"),
                           ("resource", "https://user:password@mcp-preview.veilcode.studio/mcp"),
                           ("resource", "http://127.0.0.1:3100/mcp"), ("resource", "https://mcp-preview.veilcode.studio/mcp?token=x")):
            with self.subTest(field=field, bad=bad), self.assertRaises(SetupError):
                bootstrap(mcp() | {field: bad})

    def test_credentials_and_unknown_keys_are_rejected(self):
        for key in ("access_token", "refresh_token", "password", "client_secret", "ownerId", "command", "python"):
            with self.subTest(key=key), self.assertRaises(SetupError):
                bootstrap(mcp() | {key: "do-not-accept"})
        for location in ("oauth", "account"):
            value = mt5()
            value[location]["password"] = "do-not-accept"
            with self.assertRaises(SetupError):
                bootstrap(value)

    def test_strict_versions_callbacks_and_profile(self):
        for change in ({"version": True}, {"version": 2}, {"allowLoopback": True},
                       {"profile": "../../secrets"}, {"clientId": "1234"},
                       {"redirectUri": "http://127.0.0.1:9999/callback"}):
            with self.subTest(change=change), self.assertRaises(SetupError):
                bootstrap(mcp() | change)

    def test_invalid_mt5_values(self):
        for location, key, bad in (("account", "currencyPrecision", True), ("account", "currencyPrecision", -1),
                                   ("account", "currencyPrecision", 21), ("account", "currencyCode", "usd"),
                                   ("account", "name", "bad\nname"), ("oauth", "allowLocalHttp", True),
                                   ("oauth", "applicationOrigin", "https://evil.example"),
                                   ("oauth", "callbackUri", "http://127.0.0.1:9878/callback")):
            value = mt5()
            value[location][key] = bad
            with self.subTest(key=key), self.assertRaises(SetupError):
                bootstrap(value)

    def test_input_is_not_mutated(self):
        value = mt5()
        prior = copy.deepcopy(value)
        bootstrap(value)
        self.assertEqual(value, prior)


class FileTests(unittest.TestCase):
    def test_bounds_duplicate_keys_and_non_finite(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "setup.json"
            for raw in ('{"version":1,"version":1}', '{"x":NaN}', '[]', " " * 8193):
                path.write_text(raw)
                with self.assertRaises(SetupError):
                    load_public_file(path)

    def test_unsafe_paths(self):
        for raw in ("relative.json", "\\\\server\\share\\file.json", "//server/share/file.json"):
            with self.assertRaises(SetupError):
                local_path(Path(raw))

    def test_actual_windows_profile_import_replay_and_conflict(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "download.json"
            source.write_text(json.dumps(mcp()))
            profiles = Profiles(root / "owned-profiles")
            first = profiles.import_file(source)
            self.assertEqual(first["state"], "CONFIGURED")
            self.assertEqual(first, profiles.import_file(source))
            self.assertEqual(len(profiles.list()), 1)
            source.write_text(json.dumps(mcp() | {"clientId": OWNER}))
            with self.assertRaisesRegex(SetupError, "PROFILE_CONFLICT"):
                profiles.import_file(source)
            self.assertEqual(profiles.read(ID)["clientId"], CLIENT)
            self.assertNotIn("clientId", first)

    def test_failed_staging_preserves_existing_profiles(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "download.json"
            source.write_text(json.dumps(mcp()))
            profiles = Profiles(root / "owned-profiles")
            with patch("trade_os_companion.setup.os.link", side_effect=OSError("injected publish failure")), self.assertRaises(OSError):
                profiles.import_file(source)
            self.assertFalse((profiles.root / ID / "setup.json").exists())
            self.assertFalse(list((profiles.root / ID).glob("*.tmp")))
            self.assertEqual(profiles.import_file(source)["state"], "CONFIGURED")

    def test_invalid_input_has_no_storage_effect(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "download.json"
            source.write_text(json.dumps(mcp() | {"password": "fixture"}))
            profiles = Profiles(root / "owned-profiles")
            with self.assertRaises(SetupError):
                profiles.import_file(source)
            self.assertFalse(profiles.root.exists())

    def test_profile_quota_rejects_new_but_preserves_identical_retry(self):
        with tempfile.TemporaryDirectory() as temporary, patch("trade_os_companion.setup.MAX_PROFILES", 1):
            root = Path(temporary)
            source = root / "download.json"
            source.write_text(json.dumps(mcp()))
            profiles = Profiles(root / "owned-profiles")
            first = profiles.import_file(source)
            self.assertEqual(first, profiles.import_file(source))
            source.write_text(json.dumps(mcp() | {"profile": "tradeos-" + OWNER}))
            with self.assertRaisesRegex(SetupError, "PROFILE_LIMIT"):
                profiles.import_file(source)
            self.assertFalse((profiles.root / OWNER).exists())
            self.assertEqual(profiles.list(), [first])


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest.mock import Mock, patch

from test_setup import ACCOUNT, CLIENT, ID, OWNER, mcp, mt5
from trade_os_companion.cli import perform
from trade_os_companion.setup import SetupError, bootstrap


class CommandsTests(unittest.TestCase):
    def test_unknown_or_expanded_commands_rejected(self):
        with patch("trade_os_companion.cli.default_profiles", return_value=Mock()):
            for request in (None, {"action": "SHELL", "command": "anything"}, {"action": "LIST", "ownerId": OWNER},
                            {"action": "CONSENT", "profileId": ID, "reconnect": "yes"}):
                with self.subTest(request=request), self.assertRaises(SetupError):
                    perform(request)

    def test_mt5_consent_reuses_bound_existing_oauth_without_mapping_or_collection(self):
        profiles = Mock()
        profiles.read.return_value = bootstrap(mt5())
        with (patch("trade_os_companion.cli.default_profiles", return_value=profiles),
              patch("trade_os_companion.cli.OAuthClient") as client,
              patch("trade_os_companion.cli.authorize") as consent):
            result = perform({"action": "CONSENT", "profileId": ID, "reconnect": False})
            self.assertEqual(result, {"profileId": ID, "state": "AUTHORIZED"})
            configuration = client.call_args.args[0]
            self.assertEqual(configuration.owner_id, OWNER)
            self.assertEqual(configuration.account_id, ACCOUNT)
            self.assertEqual(configuration.client_id, CLIENT)
            self.assertFalse(configuration.allow_local_http)
            consent.assert_called_once_with(client.return_value, "http://127.0.0.1:9876/callback", reconnect=False)

    def test_reconnect_is_an_explicit_boolean(self):
        profiles = Mock()
        profiles.read.return_value = bootstrap(mt5())
        with (patch("trade_os_companion.cli.default_profiles", return_value=profiles),
              patch("trade_os_companion.cli.OAuthClient") as client,
              patch("trade_os_companion.cli.authorize") as consent):
            perform({"action": "CONSENT", "profileId": ID, "reconnect": True})
            consent.assert_called_once_with(client.return_value, "http://127.0.0.1:9876/callback", reconnect=True)

    def test_verify_access_checks_exact_owner_account_and_client(self):
        profiles = Mock()
        profiles.read.return_value = bootstrap(mt5())
        with (patch("trade_os_companion.cli.default_profiles", return_value=profiles),
              patch("trade_os_companion.cli.OAuthClient") as client,
              patch("trade_os_companion.cli.IntegrationApi") as api):
            result = perform({"action": "VERIFY_ACCESS", "profileId": ID})
            self.assertEqual(result["state"], "AUTHORIZED")
            api.assert_called_once_with("https://tradeos.veilcode.studio", client.return_value)
            api.return_value.verify_account.assert_called_once_with(OWNER, ACCOUNT, client_id=CLIENT)

    def test_mcp_cannot_use_mt5_consent_or_account_authorization(self):
        profiles = Mock()
        profiles.read.return_value = bootstrap(mcp())
        with (patch("trade_os_companion.cli.default_profiles", return_value=profiles),
              patch("trade_os_companion.cli.OAuthClient") as client):
            for request in ({"action": "CONSENT", "profileId": ID, "reconnect": False}, {"action": "VERIFY_ACCESS", "profileId": ID}):
                with self.assertRaises(SetupError):
                    perform(request)
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()

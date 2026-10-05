import base64
import json
import unittest
from contextlib import nullcontext
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

from test_outbox import ACCOUNT, CONNECTION, OWNER

from trade_os_mt5.api import ApiError
from trade_os_mt5.oauth import OAuthClient, OAuthConfiguration
from trade_os_mt5.windows_security import CredentialError

NOW = datetime(2026, 1, 1, tzinfo=UTC)
CALLBACK = "http://127.0.0.1:9876/callback"
ISSUER = "https://fixture.supabase.co/auth/v1"
ORIGIN = "https://trade.example"
RESOURCE = ORIGIN + "/api/integrations/v1"


def token(**overrides):
    claims = {
        "iss": ISSUER,
        "sub": OWNER,
        "client_id": CONNECTION,
        "aud": RESOURCE,
        "trade_os_resource": RESOURCE,
        "exp": int((NOW + timedelta(hours=1)).timestamp()),
        **overrides,
    }
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return "header." + payload + ".signature"


def response(**overrides):
    return {
        "access_token": token(),
        "refresh_token": "SYNTHETIC.refresh.token",
        "token_type": "bearer",
        "expires_in": 3600,
        **overrides,
    }


class MemoryStore:
    def __init__(self):
        self.record = None
        self.writes = []

    def lock(self):
        return nullcontext()

    def load(self, context):
        return deepcopy(self.record)

    def save(self, record, context):
        self.record = deepcopy(record)
        self.writes.append(deepcopy(record))


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.client = OAuthClient(
            OAuthConfiguration(ISSUER, ORIGIN, OWNER, ACCOUNT, CONNECTION), store=self.store, now=lambda: NOW
        )
        self.calls = []
        self.next_response = response()
        self.request = patch.object(self.client, "_request", side_effect=self.fake_request)
        self.request.start()
        self.verification = patch("trade_os_mt5.oauth.IntegrationApi.verify_account", return_value={"grant_id": OWNER})
        self.verify = self.verification.start()

    def tearDown(self):
        self.request.stop()
        self.verification.stop()

    def fake_request(self, path, form=None):
        self.calls.append((path, deepcopy(form)))
        if path.startswith("/.well-known"):
            return {
                "issuer": ISSUER,
                "authorization_endpoint": ISSUER + "/oauth/authorize",
                "token_endpoint": ISSUER + "/oauth/token",
                "code_challenge_methods_supported": ["S256"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "token_endpoint_auth_methods_supported": ["none"],
            }
        if isinstance(self.next_response, Exception):
            raise self.next_response
        return self.next_response

    def begin(self):
        url = self.client.begin(CALLBACK)
        return parse_qs(urlsplit(url).query)

    def complete(self):
        query = self.begin()
        self.client.finish(CALLBACK + "?" + urlencode({"code": "fixture-code", "state": query["state"][0]}))

    def test_pkce_s256_state_and_resource_are_bound_to_persisted_verifier(self):
        query = self.begin()
        import hashlib

        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(self.store.record["verifier"].encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        self.assertEqual(query["code_challenge"], [expected])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["resource"], [RESOURCE])
        self.assertNotIn(self.store.record["verifier"], urlencode(query))
        self.assertGreaterEqual(len(self.store.record["verifier"]), 43)
        self.assertEqual(query["state"], [self.store.record["csrf"]])

    def test_initial_exchange_is_verified_live_before_ready_and_has_no_client_secret(self):
        self.complete()
        self.assertEqual(self.store.record["state"], "READY")
        self.assertEqual([record["state"] for record in self.store.writes], ["AUTHORIZING", "EXCHANGING", "READY"])
        form = self.calls[-1][1]
        self.assertEqual(form["resource"], RESOURCE)
        self.assertNotIn("client_secret", form)
        self.assertEqual(self.verify.call_args.kwargs["client_id"], CONNECTION)

    def test_bad_state_duplicate_or_wrong_callback_cannot_spend_code(self):
        query = self.begin()
        for url in (
            CALLBACK + "?code=fixture&state=wrong",
            CALLBACK + "?code=a&code=b&state=" + query["state"][0],
            "http://127.0.0.1:9877/callback?" + urlencode({"code": "fixture", "state": query["state"][0]}),
            CALLBACK + "?private-code-without-equals",
        ):
            with self.subTest(url=url), self.assertRaises(CredentialError):
                self.client.finish(url)
        self.assertEqual(self.store.record["state"], "AUTHORIZING")
        self.assertEqual(len(self.calls), 1)

    def test_wrong_response_issuer_owner_client_resource_or_expiry_never_ready(self):
        for field, value in (
            ("iss", "https://evil.example"),
            ("sub", ACCOUNT),
            ("client_id", ACCOUNT),
            ("aud", "wrong"),
            ("trade_os_resource", "wrong"),
            ("exp", int(NOW.timestamp())),
        ):
            self.store.record = None
            self.next_response = response(access_token=token(**{field: value}))
            query = self.begin()
            with self.subTest(field=field), self.assertRaises(CredentialError):
                self.client.finish(CALLBACK + "?" + urlencode({"code": "fixture", "state": query["state"][0]}))
            self.assertEqual(self.store.record["state"], "REAUTH_REQUIRED")
        self.verify.assert_not_called()

    def test_unsigned_structural_token_is_not_authorization(self):
        self.verify.side_effect = ApiError("INTEGRATION_ACCESS_DENIED")
        with self.assertRaises(CredentialError):
            self.complete()
        self.assertEqual(self.store.record["state"], "REAUTH_REQUIRED")

    def test_standard_jwt_audience_array_requires_intended_resource(self):
        self.next_response = response(access_token=token(aud=["authenticated", RESOURCE]))
        self.complete()
        self.assertEqual(self.store.record["state"], "READY")
        self.store.record = None
        self.next_response = response(access_token=token(aud=["authenticated", "https://wrong.example"]))
        with self.assertRaises(CredentialError):
            self.complete()
        self.assertEqual(self.store.record["state"], "REAUTH_REQUIRED")

    def test_usable_token_does_not_refresh_on_every_call(self):
        self.complete()
        count = len(self.calls)
        self.assertEqual(self.client.access_token(), token())
        self.assertEqual(self.client.access_token(), token())
        self.assertEqual(len(self.calls), count)

    def test_refresh_rotates_record_only_after_live_verification(self):
        self.complete()
        self.store.record["expiresAt"] = NOW.isoformat()
        self.next_response = response(refresh_token="NEW.synthetic.refresh")
        self.assertEqual(self.client.access_token(), token())
        self.assertEqual([r["state"] for r in self.store.writes][-2:], ["REFRESHING", "READY"])
        self.assertEqual(self.store.record["refreshToken"], "NEW.synthetic.refresh")
        self.assertEqual(
            self.calls[-1][1],
            {
                "grant_type": "refresh_token",
                "refresh_token": "SYNTHETIC.refresh.token",
                "client_id": CONNECTION,
                "resource": RESOURCE,
            },
        )

    def test_refresh_without_new_refresh_token_retains_original_as_documented(self):
        self.complete()
        self.store.record["expiresAt"] = NOW.isoformat()
        self.next_response = {k: v for k, v in response().items() if k != "refresh_token"}
        self.client.access_token()
        self.assertEqual(self.store.record["refreshToken"], "SYNTHETIC.refresh.token")

    def test_refresh_lost_ack_requires_consent_not_replay_of_old_rotating_token(self):
        self.complete()
        self.store.record["expiresAt"] = NOW.isoformat()
        self.next_response = CredentialError("OAUTH_REQUEST_UNCERTAIN")
        with self.assertRaises(CredentialError):
            self.client.access_token()
        self.assertEqual(self.store.record, {"state": "REAUTH_REQUIRED"})
        count = len(self.calls)
        with self.assertRaises(CredentialError):
            self.client.access_token()
        self.assertEqual(len(self.calls), count)

    def test_restart_during_exchange_or_refresh_never_uses_partial_credentials(self):
        for state in ("EXCHANGING", "REFRESHING", "REAUTH_REQUIRED"):
            self.store.record = {"state": state}
            with self.subTest(state=state), self.assertRaises(CredentialError):
                self.client.access_token()
        self.assertEqual(self.calls, [])

    def test_callback_expired_or_clock_moved_backward_requires_fresh_consent(self):
        query = self.begin()
        for time in (NOW - timedelta(seconds=1), NOW + timedelta(minutes=11)):
            self.client.now = lambda time=time: time
            with self.assertRaises(CredentialError):
                self.client.finish(CALLBACK + "?" + urlencode({"code": "fixture", "state": query["state"][0]}))

    def test_provider_denial_removes_pending_verifier_without_error_description_leak(self):
        query = self.begin()
        with self.assertRaises(CredentialError) as error:
            self.client.finish(
                CALLBACK
                + "?"
                + urlencode(
                    {"error": "access_denied", "state": query["state"][0], "error_description": "PRIVATE_DETAIL"}
                )
            )
        self.assertEqual(str(error.exception), "OAUTH_CONSENT_DENIED")
        self.assertEqual(self.store.record, {"state": "REAUTH_REQUIRED"})

    def test_failed_discovery_never_creates_pending_credentials(self):
        with patch.object(self.client, "_request", return_value={"issuer": "https://evil.example"}):
            with self.assertRaises(CredentialError):
                self.client.begin(CALLBACK)
        self.assertIsNone(self.store.record)

    def test_malformed_discovery_capability_shapes_fail_closed(self):
        good = self.fake_request("/.well-known/openid-configuration")
        for key in (
            "code_challenge_methods_supported",
            "grant_types_supported",
            "token_endpoint_auth_methods_supported",
        ):
            for invalid in (None, "S256", [True]):
                with patch.object(self.client, "_request", return_value={**good, key: invalid}):
                    with self.subTest(key=key, invalid=invalid), self.assertRaises(CredentialError):
                        self.client.begin(CALLBACK)
        self.assertIsNone(self.store.record)

    def test_existing_credentials_require_explicit_reconnect_not_casual_overwrite(self):
        self.complete()
        previous = deepcopy(self.store.record)
        with self.assertRaises(CredentialError):
            self.client.begin(CALLBACK)
        self.assertEqual(previous, self.store.record)
        self.client.begin(CALLBACK, reconnect=True)
        self.assertEqual(self.store.record["state"], "AUTHORIZING")

    def test_configuration_rejects_insecure_or_unexpected_issuer_paths(self):
        for issuer in (
            "http://fixture.supabase.co/auth/v1",
            "https://fixture.supabase.co/other",
            "https://fixture.supabase.co/auth/v1?x=1",
        ):
            with self.subTest(issuer=issuer), self.assertRaises((CredentialError, ApiError)):
                OAuthClient(OAuthConfiguration(issuer, ORIGIN, OWNER, ACCOUNT, CONNECTION), store=self.store)
        for callback in (
            "http://localhost:9876/callback",
            "https://127.0.0.1:9876/callback",
            "http://0.0.0.0:9876/callback",
            "http://127.0.0.1:9876/callback?x=1",
        ):
            with self.assertRaises(CredentialError):
                self.client.begin(callback)


if __name__ == "__main__":
    unittest.main()

import json
import ssl
import threading
import time
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import URLError

from test_outbox import ACCOUNT, CONNECTION, OWNER

from trade_os_mt5.api import ApiError, IntegrationApi
from trade_os_mt5.outbox import Binding

TOKEN = "header.payload.signature"


@contextmanager
def serve(status=200, body=None, *, raw=None, content_type="application/json", delay=0, location=None):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requests.append({"path": self.path, "authorization": self.headers.get("Authorization")})
            if delay:
                time.sleep(delay)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            if location:
                self.send_header("Location", location)
            self.end_headers()
            try:
                self.wfile.write(raw if raw is not None else json.dumps(body or {}).encode())
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        worker.join(2)


def session():
    return {"version": "v1", "actor": {"user_id": OWNER, "account_id": ACCOUNT, "purpose": "MT5"}}


class ApiTests(unittest.TestCase):
    def test_renewable_provider_attention_error_is_preserved_not_masked(self):
        def provider():
            raise ApiError("OAUTH_REAUTHORIZATION_REQUIRED")

        api = IntegrationApi("https://trade.example", provider)
        with patch.object(api._opener, "open") as network:
            with self.assertRaises(ApiError) as error:
                api._request("/session")
            self.assertEqual(error.exception.code, "OAUTH_REAUTHORIZATION_REQUIRED")
            network.assert_not_called()

    def test_expected_client_id_must_match_authoritative_session(self):
        data = session()
        with serve(body=data) as (origin, _):
            api = IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)
            data["actor"]["resource"] = api.resource
            data["actor"]["client_id"] = CONNECTION
            api.verify_account(OWNER, ACCOUNT, client_id=CONNECTION)
            with self.assertRaises(ApiError) as error:
                api.verify_account(OWNER, ACCOUNT, client_id=OWNER)
            self.assertEqual(error.exception.code, "INTEGRATION_ACCOUNT_MISMATCH")

    def test_plain_http_requires_explicit_local_test_allowance(self):
        for origin in ("http://trade.example", "http://127.0.0.1:3100", "ftp://trade.example"):
            with self.subTest(origin=origin), self.assertRaises(ApiError):
                IntegrationApi(origin, lambda: TOKEN)
        with self.assertRaises(ApiError):
            IntegrationApi("http://trade.example", lambda: TOKEN, allow_local_http=True)

    def test_url_credentials_paths_queries_and_fragments_are_rejected(self):
        for origin in (
            "https://user:password@trade.example",
            "https://trade.example/a",
            "https://trade.example?x=1",
            "https://trade.example/#x",
            "https://trade.example\n",
            "https://trade.example:99999",
            "https://trade.example\\evil.example",
            "https://trade%2Eexample",
            "https://tradé.example",
        ):
            with self.subTest(origin=origin), self.assertRaises(ApiError):
                IntegrationApi(origin, lambda: TOKEN)

    def test_bearer_auth_and_resource_binding_are_used(self):
        with serve() as (origin, requests):
            api = IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)
            result = session()
            result["actor"]["resource"] = api.resource
            with patch.object(api, "_request", wraps=api._request):
                # Public local transport check, followed by actual binding fixture.
                self.assertEqual(api._request("/session"), {})
            self.assertEqual(requests, [{"path": "/api/integrations/v1/session", "authorization": "Bearer " + TOKEN}])
        with serve(body=result) as (origin, _):
            api = IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)
            result["actor"]["resource"] = api.resource
            # The fixture body is mutable until serialized by the server.
            api.verify_binding(Binding(OWNER, ACCOUNT, CONNECTION))

    def test_owner_account_purpose_and_resource_must_all_match(self):
        for field, value in (
            ("user_id", CONNECTION),
            ("account_id", CONNECTION),
            ("purpose", "MCP"),
            ("resource", "https://evil.example"),
        ):
            data = session()
            with serve(body=data) as (origin, requests):
                api = IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)
                data["actor"]["resource"] = api.resource
                data["actor"][field] = value
                with self.assertRaises(ApiError) as error:
                    api.verify_binding(Binding(OWNER, ACCOUNT, CONNECTION))
                self.assertEqual(error.exception.code, "INTEGRATION_ACCOUNT_MISMATCH")
                self.assertEqual(len(requests), 1)

    def test_redirects_never_forward_bearer_to_another_endpoint(self):
        with serve() as (sink, sink_requests), serve(status=302, location=sink) as (origin, _):
            api = IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)
            with self.assertRaises(ApiError) as error:
                api._request("/session")
            self.assertEqual(error.exception.code, "API_REDIRECT_DENIED")
            self.assertEqual(sink_requests, [])

    def test_proxy_environment_cannot_change_token_destination(self):
        with (
            serve() as (origin, requests),
            patch.dict("os.environ", {"http_proxy": "http://127.0.0.1:1", "HTTP_PROXY": "http://127.0.0.1:1"}),
        ):
            self.assertEqual(IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)._request("/session"), {})
            self.assertEqual(len(requests), 1)

    def test_invalid_json_duplicate_keys_nan_and_oversize_responses_fail_closed(self):
        for raw in (b"not-json", b'{"x":1,"x":2}', b'{"x":NaN}', b"[]", b"x" * 1_048_577):
            with self.subTest(raw_length=len(raw)), serve(raw=raw) as (origin, _):
                with self.assertRaises(ApiError) as error:
                    IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)._request("/session")
                self.assertEqual(error.exception.code, "INVALID_API_RESPONSE")

    def test_non_json_success_is_not_treated_as_authenticated_data(self):
        with serve(content_type="text/html") as (origin, _):
            with self.assertRaises(ApiError):
                IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)._request("/session")

    def test_network_lag_is_retryable_but_timeout_does_not_accept_a_response(self):
        with serve(delay=0.2) as (origin, _):
            with self.assertRaises(ApiError) as error:
                IntegrationApi(origin, lambda: TOKEN, allow_local_http=True, timeout=0.05)._request("/session")
            self.assertEqual(error.exception.code, "INTEGRATION_UNAVAILABLE")
            self.assertTrue(error.exception.retryable)

    def test_error_classification_preserves_secrets_and_requires_attention_for_auth(self):
        cases = [
            (401, "INTEGRATION_ACCESS_DENIED", False),
            (403, "INTEGRATION_ACCESS_DENIED", False),
            (429, "INTEGRATION_UNAVAILABLE", True),
            (503, "INTEGRATION_UNAVAILABLE", True),
            (409, "COLLECTOR_REQUIRES_ATTENTION", False),
        ]
        for status, code, retryable in cases:
            with (
                self.subTest(status=status),
                serve(status=status, body={"error": "PRIVATE_SOURCE_AND_TOKEN"}) as (origin, _),
            ):
                with self.assertRaises(ApiError) as error:
                    IntegrationApi(origin, lambda: TOKEN, allow_local_http=True)._request("/session")
                self.assertEqual(error.exception.code, code)
                self.assertEqual(error.exception.retryable, retryable)
                self.assertNotIn("PRIVATE", str(error.exception))

    def test_certificate_verification_failure_is_not_endlessly_retried(self):
        api = IntegrationApi("https://trade.example", lambda: TOKEN)
        with patch.object(
            api._opener, "open", side_effect=URLError(ssl.SSLCertVerificationError("PRIVATE_CERT_DETAIL"))
        ):
            with self.assertRaises(ApiError) as error:
                api._request("/session")
        self.assertEqual(error.exception.code, "TLS_VERIFICATION_FAILED")
        self.assertFalse(error.exception.retryable)

    def test_invalid_token_or_provider_exception_is_not_logged_or_sent(self):
        def failing_provider():
            raise RuntimeError("PRIVATE_TOKEN")

        with serve() as (origin, requests):
            for provider in (lambda: "token\r\nInjected: header", failing_provider):
                with self.assertRaises(ApiError) as error:
                    IntegrationApi(origin, provider, allow_local_http=True)._request("/session")
                self.assertEqual(str(error.exception), "INTEGRATION_ACCESS_DENIED")
            self.assertEqual(requests, [])

    def test_operation_lookup_id_must_match_and_unknown_must_be_exact(self):
        with serve(body={"operationId": ACCOUNT, "status": "UNKNOWN"}) as (origin, _):
            with self.assertRaises(ApiError):
                IntegrationApi(origin, lambda: TOKEN, allow_local_http=True).operation(OWNER, CONNECTION)


if __name__ == "__main__":
    unittest.main()

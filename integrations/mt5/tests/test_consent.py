import http.client
import socket
import threading
import unittest
from unittest.mock import Mock
from urllib.parse import urlencode

from trade_os_mt5.consent import _request_url, authorize
from trade_os_mt5.windows_security import CredentialError

STATE = "synthetic-state-value"


def free_port():
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        return holder.getsockname()[1]


class ConsentTests(unittest.TestCase):
    def request(self, target="/callback?state=" + STATE + "&code=synthetic-code", host="127.0.0.1:9876", extra=""):
        return f"GET {target} HTTP/1.1\r\nHost: {host}\r\n{extra}\r\n".encode()

    def test_valid_callback_is_origin_form_and_state_bound(self):
        result = _request_url(self.request(), "http://127.0.0.1:9876/callback", STATE)
        self.assertEqual(result, "http://127.0.0.1:9876/callback?state=" + STATE + "&code=synthetic-code")

    def test_invalid_requests_never_reach_oauth_exchange(self):
        for request in (
            self.request(host="localhost:9876"),
            self.request(host="evil.example"),
            self.request("/callback?state=wrong&code=x"),
            self.request("http://127.0.0.1:9876/callback?state=" + STATE + "&code=x"),
            self.request("/callback?state=" + STATE + "&code=x&code=y"),
            self.request("/callback?state=" + STATE + "&code=x&error=denied"),
            self.request(extra="Host: evil.example\r\n"),
            self.request(extra="Content-Length: 1\r\n"),
            self.request(extra="Transfer-Encoding: chunked\r\n"),
            self.request(extra="Origin: https://evil.example\r\n"),
            self.request(extra=" Folded: value\r\n"),
            self.request() + b"body",
            self.request().replace(b"GET", b"POST", 1),
            b"x" * 8193,
        ):
            with self.subTest(request=request[:80]), self.assertRaises(CredentialError):
                _request_url(request, "http://127.0.0.1:9876/callback", STATE)

    def test_listener_validates_bad_request_then_completes_actual_loopback_request(self):
        port = free_port()
        client = Mock()
        client.begin.return_value = "https://fixture.example/authorize?state=" + STATE
        failures, statuses = [], []

        def browser(url):
            def send():
                try:
                    for state in ("wrong", STATE):
                        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                        try:
                            connection.request(
                                "GET", "/callback?" + urlencode({"code": "synthetic-code", "state": state})
                            )
                            response = connection.getresponse()
                            statuses.append(response.status)
                            body = response.read()
                            self.assertNotIn(b"synthetic-code", body)
                            self.assertEqual(response.getheader("Cache-Control"), "no-store")
                        finally:
                            connection.close()
                except BaseException as error:
                    failures.append(error)

            self.thread = threading.Thread(target=send)
            self.thread.start()
            return True

        authorize(client, f"http://127.0.0.1:{port}/callback", open_browser=browser, timeout=5)
        self.thread.join(3)
        self.assertFalse(self.thread.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(statuses, [400, 200])
        client.finish.assert_called_once()

    def test_busy_port_is_rejected_before_credential_or_browser_changes(self):
        client, browser = Mock(), Mock()
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", 0))
            holder.listen()
            with self.assertRaisesRegex(CredentialError, "OAUTH_CALLBACK_PORT_UNAVAILABLE"):
                authorize(client, f"http://127.0.0.1:{holder.getsockname()[1]}/callback", open_browser=browser)
        client.begin.assert_not_called()
        browser.assert_not_called()

    def test_callback_timeout_and_browser_failure_are_explicit(self):
        client = Mock()
        client.begin.return_value = "https://fixture.example/authorize?state=" + STATE
        for launched, code in ((True, "OAUTH_CALLBACK_TIMEOUT"), (False, "OAUTH_BROWSER_UNAVAILABLE")):
            with self.assertRaisesRegex(CredentialError, code):
                authorize(
                    client,
                    f"http://127.0.0.1:{free_port()}/callback",
                    open_browser=lambda url, result=launched: result,
                    timeout=0.05,
                )
        client.finish.assert_not_called()

    def test_nonloopback_uri_and_invalid_deadline_are_rejected(self):
        for uri, timeout in (
            ("http://localhost:9876/callback", 1),
            ("http://0.0.0.0:9876/callback", 1),
            ("http://127.0.0.1:9876/callback?x=y", 1),
            ("http://127.0.0.1:9876/callback", float("nan")),
            ("http://127.0.0.1:9876/callback", 601),
        ):
            with self.assertRaises(CredentialError):
                authorize(Mock(), uri, timeout=timeout)

import socket
import ssl
import unittest
from unittest.mock import Mock, patch

from trade_os_mt5.api import IntegrationApi
from trade_os_mt5.https_transport import FailoverHTTPSConnection, FailoverHTTPSHandler


class HttpsTransportTests(unittest.TestCase):
    def test_unreachable_address_falls_back_before_tls_with_original_hostname(self):
        context = ssl.create_default_context()
        connection = FailoverHTTPSConnection("trade.example", timeout=15, context=context)
        original_dial = connection._create_connection
        unavailable, available = Mock(spec=socket.socket), Mock(spec=socket.socket)
        unavailable.connect.side_effect = TimeoutError()
        addresses = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.1", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.2", 443)),
        ]
        with (
            patch("socket.getaddrinfo", return_value=addresses),
            patch("socket.socket", side_effect=[unavailable, available]),
            patch.object(context, "wrap_socket", return_value=available) as handshake,
        ):
            connection.connect()
        unavailable.settimeout.assert_called_once_with(3.0)
        unavailable.close.assert_called_once()
        available.connect.assert_called_once_with(("192.0.2.2", 443))
        self.assertEqual([call.args for call in available.settimeout.call_args_list], [(3.0,), (15,)])
        handshake.assert_called_once_with(available, server_hostname="trade.example")
        self.assertIs(connection._create_connection, original_dial)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_shorter_caller_timeout_is_never_increased(self):
        context = ssl.create_default_context()
        connection = FailoverHTTPSConnection("trade.example", timeout=0.05, context=context)
        raw = Mock(spec=socket.socket)
        dial = Mock(return_value=raw)
        connection._create_connection = dial
        with patch.object(context, "wrap_socket", return_value=raw):
            connection.connect()
        dial.assert_called_once_with(("trade.example", 443), 0.05, None)
        raw.settimeout.assert_called_once_with(0.05)
        self.assertEqual(connection.timeout, 0.05)

    def test_failed_tcp_addresses_remain_failure_and_release_sockets(self):
        context = ssl.create_default_context()
        connection = FailoverHTTPSConnection("trade.example", timeout=15, context=context)
        original_dial = connection._create_connection
        sockets = [Mock(spec=socket.socket), Mock(spec=socket.socket)]
        for raw in sockets:
            raw.connect.side_effect = TimeoutError()
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (f"192.0.2.{i}", 443)) for i in (1, 2)]
        with (
            patch("socket.getaddrinfo", return_value=addresses),
            patch("socket.socket", side_effect=sockets),
            patch.object(context, "wrap_socket") as handshake,
        ):
            with self.assertRaises(TimeoutError):
                connection.connect()
        for raw in sockets:
            raw.close.assert_called_once()
        handshake.assert_not_called()
        self.assertIs(connection._create_connection, original_dial)

    def test_certificate_failure_never_triggers_another_dial_or_weaker_context(self):
        context = ssl.create_default_context()
        connection = FailoverHTTPSConnection("trade.example", timeout=15, context=context)
        raw, dial = Mock(spec=socket.socket), Mock()
        dial.return_value = raw
        connection._create_connection = dial
        with patch.object(context, "wrap_socket", side_effect=ssl.SSLCertVerificationError()):
            with self.assertRaises(ssl.SSLCertVerificationError):
                connection.connect()
        self.assertEqual(dial.call_count, 1)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertIs(connection._create_connection, dial)

    def test_timeout_restore_failure_closes_connection(self):
        connection = FailoverHTTPSConnection("trade.example", timeout=15)
        raw = Mock(spec=socket.socket)
        raw.settimeout.side_effect = OSError()
        connection._create_connection = Mock(return_value=raw)
        with self.assertRaises(OSError):
            connection.connect()
        raw.close.assert_called_once()

    def test_api_uses_one_strict_handler_without_automatic_http_replay(self):
        api = IntegrationApi("https://trade.example", lambda: "header.payload.signature")
        handlers = [handler for handler in api._opener.handlers if isinstance(handler, FailoverHTTPSHandler)]
        self.assertEqual(len(handlers), 1)
        handler = handlers[0]
        self.assertTrue(handler._context.check_hostname)
        self.assertEqual(handler._context.verify_mode, ssl.CERT_REQUIRED)
        request = object()
        with patch.object(handler, "do_open", return_value="response") as dispatch:
            self.assertEqual(handler.https_open(request), "response")
        dispatch.assert_called_once_with(FailoverHTTPSConnection, request, context=handler._context)


if __name__ == "__main__":
    unittest.main()

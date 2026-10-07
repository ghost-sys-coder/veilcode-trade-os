"""Fast TCP address fallback without changing DNS, TLS, or HTTP retry policy.

CPython 3.13's socket.create_connection tries each resolved address sequentially.
Do not spend the full response timeout on every unreachable TCP address. TLS and
HTTP retain the caller's original timeout; the supervisor still bounds the entire
worker. No hostname rewriting, IP pinning, proxy, or request replay is added.
"""

import math
from http.client import HTTPSConnection
from urllib.request import HTTPSHandler

TCP_ATTEMPT_SECONDS = 3.0


class FailoverHTTPSConnection(HTTPSConnection):
    def connect(self):
        # CPython exposes this per-instance dial hook to replace for testing.
        # Keep the native DNS/address loop and HTTPSConnection's SNI/TLS logic.
        original_dial = self._create_connection

        def dial(address, timeout, source_address):
            if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
                raise ValueError("Explicit positive connection timeout required")
            connection = original_dial(address, min(timeout, TCP_ATTEMPT_SECONDS), source_address)
            try:
                # Restore before the native TLS handshake, not only before reads.
                connection.settimeout(timeout)
                return connection
            except BaseException:
                connection.close()
                raise

        self._create_connection = dial
        try:
            super().connect()
        finally:
            self._create_connection = original_dial


class FailoverHTTPSHandler(HTTPSHandler):
    def https_open(self, request):
        return self.do_open(FailoverHTTPSConnection, request, context=self._context)

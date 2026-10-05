"""Short-lived, loopback-only OAuth callback receiver. Never logs request URLs.

No HTTP file server, listening on external interfaces, token export or redirect.
The callback port must already be registered with the public OAuth client.
"""

import math
import os
import secrets
import socket
import time
import webbrowser
from urllib.parse import parse_qs, urlsplit

from .oauth import OAuthClient, _callback
from .windows_security import CredentialError

MAX_HEADERS = 8192


def _request_url(raw: bytes, callback_uri: str, expected_state: str) -> str:
    """Validate a complete, bounded origin-form HTTP request before code exchange."""
    try:
        if len(raw) > MAX_HEADERS or not raw.endswith(b"\r\n\r\n"):
            raise ValueError
        lines = raw.decode("ascii").split("\r\n")
        method, target, version = lines[0].split(" ")
        if method != "GET" or version not in ("HTTP/1.0", "HTTP/1.1"):
            raise ValueError
        if not target.startswith("/callback?") or "\\" in target or "#" in target:
            raise ValueError
        headers = {}
        for line in lines[1:-2]:
            key, value = line.split(":", 1)
            key = key.lower()
            if not key or key in headers or key != key.strip() or any(ord(c) < 32 for c in value):
                raise ValueError
            headers[key] = value.strip()
        parsed = _callback(callback_uri)
        if (
            headers.get("host") != parsed.netloc
            or "transfer-encoding" in headers
            or headers.get("content-length", "0") != "0"
            or "origin" in headers
        ):
            raise ValueError
        candidate = callback_uri.split("/callback", 1)[0] + target
        query = parse_qs(urlsplit(candidate).query, strict_parsing=True, keep_blank_values=True)
        if (
            set(query) - {"code", "state", "error", "error_description", "iss"}
            or any(len(values) != 1 for values in query.values())
            or not secrets.compare_digest(query.get("state", [""])[0], expected_state)
            or ("code" in query) == ("error" in query)
        ):
            raise ValueError
        return candidate
    except (ValueError, UnicodeError, TypeError):
        raise CredentialError("INVALID_OAUTH_CALLBACK") from None


def _reply(connection, success: bool):
    body = (
        b"Trade OS connection approved. You can close this tab."
        if success
        else b"Trade OS callback not accepted. Return to the consent window."
    )
    status = b"200 OK" if success else b"400 Bad Request"
    message = (
        b"HTTP/1.1 " + status + b"\r\nContent-Type: text/plain; charset=utf-8\r\n"
        b"Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n"
        b"Content-Security-Policy: default-src 'none'\r\nX-Content-Type-Options: nosniff\r\n"
        b"Connection: close\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
    )
    try:
        connection.sendall(message)
    except OSError:
        # Losing the browser reply does not undo an already durable credential.
        pass


def authorize(
    client: OAuthClient,
    callback_uri: str,
    *,
    reconnect: bool = False,
    timeout: float = 600,
    open_browser=webbrowser.open,
) -> None:
    parsed = _callback(callback_uri)
    if parsed.query or type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 600:
        raise CredentialError("INVALID_OAUTH_CALLBACK")
    if type(reconnect) is not bool:
        raise CredentialError("INVALID_OAUTH_CONFIGURATION")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        if os.name == "nt":
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            # Bind BEFORE beginning consent, without stealing/reusing occupied ports.
            listener.bind(("127.0.0.1", parsed.port))
            listener.listen(4)
        except OSError:
            raise CredentialError("OAUTH_CALLBACK_PORT_UNAVAILABLE") from None
        authorization_url = client.begin(callback_uri, reconnect=reconnect)
        expected_state = parse_qs(urlsplit(authorization_url).query)["state"][0]
        deadline = time.monotonic() + timeout
        try:
            launched = open_browser(authorization_url)
        except Exception:
            raise CredentialError("OAUTH_BROWSER_UNAVAILABLE") from None
        if not launched:
            raise CredentialError("OAUTH_BROWSER_UNAVAILABLE")
        while time.monotonic() < deadline:
            listener.settimeout(min(0.25, max(0.001, deadline - time.monotonic())))
            try:
                connection, peer = listener.accept()
            except TimeoutError:
                continue
            with connection:
                if peer[0] != "127.0.0.1":
                    continue
                request_deadline = min(deadline, time.monotonic() + 2)
                raw = b""
                try:
                    while b"\r\n\r\n" not in raw and len(raw) <= MAX_HEADERS:
                        remaining = request_deadline - time.monotonic()
                        if remaining <= 0:
                            raise ValueError
                        connection.settimeout(remaining)
                        chunk = connection.recv(min(1024, MAX_HEADERS + 1 - len(raw)))
                        if not chunk:
                            raise ValueError
                        raw += chunk
                    callback_url = _request_url(raw, callback_uri, expected_state)
                except (OSError, ValueError, CredentialError):
                    _reply(connection, False)
                    continue
                try:
                    client.finish(callback_url)
                except CredentialError as error:
                    _reply(connection, False)
                    if error.code == "INVALID_OAUTH_CALLBACK":
                        continue  # An unrelated request cannot consume consent.
                    raise
                _reply(connection, True)
                return
        raise CredentialError("OAUTH_CALLBACK_TIMEOUT")

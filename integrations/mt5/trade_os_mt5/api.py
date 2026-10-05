"""Resource-bound application HTTP client. No broker or model-provider APIs."""

import ipaddress
import json
import re
import ssl
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

from .json_boundary import reject_constant as _reject_constant
from .json_boundary import unique_object as _unique_object
from .outbox import Binding, OutboxError, _uuid

MAX_RESPONSE_BYTES = 1_048_576


class ApiError(Exception):
    def __init__(self, code: str, *, retryable: bool = False):
        self.code = code
        self.retryable = retryable
        super().__init__(code)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def utc_response(value: Any) -> str:
    """Normalize PostgreSQL receipt timestamps to the API's UTC milliseconds."""
    try:
        if not isinstance(value, str):
            raise ValueError
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, TypeError) as error:
        raise ApiError("INVALID_API_RESPONSE") from error


def lease_response(result: Any, connection_id: str) -> dict[str, Any]:
    if (
        not isinstance(result, dict)
        or set(result) != {"connectionId", "fencingToken", "leaseExpiresAt"}
        or result["connectionId"] != connection_id
        or not isinstance(result["fencingToken"], str)
        or not re.fullmatch(r"[1-9][0-9]*", result["fencingToken"])
    ):
        raise ApiError("INVALID_API_RESPONSE")
    return {**result, "leaseExpiresAt": utc_response(result["leaseExpiresAt"])}


def capture_response(result: Any, connection_id: str) -> dict[str, Any]:
    if not isinstance(result, dict) or result.get("connectionId") != connection_id:
        raise ApiError("INVALID_API_RESPONSE")
    if result.get("status") == "ATTENTION":
        raise ApiError("COLLECTOR_REQUIRES_ATTENTION")
    keys = {
        "connectionId",
        "status",
        "revisionCount",
        "checkpoint",
        "collectionId",
        "collectionComplete",
        "receivedBatchCount",
        "reviewCount",
    }
    if (
        set(result) != keys
        or result["status"] != "STAGED"
        or type(result["collectionComplete"]) is not bool
        or any(
            type(result[field]) is not int or result[field] < 0
            for field in ("revisionCount", "receivedBatchCount", "reviewCount")
        )
    ):
        raise ApiError("INVALID_API_RESPONSE")
    try:
        _uuid(result["collectionId"])
    except OutboxError:
        raise ApiError("INVALID_API_RESPONSE") from None
    return {**result, "checkpoint": None if result["checkpoint"] is None else utc_response(result["checkpoint"])}


class IntegrationApi:
    def __init__(
        self, origin: str, access_token: Callable[[], str], *, allow_local_http: bool = False, timeout: float = 15
    ):
        try:
            url = urlsplit(origin)
            loopback = url.hostname == "localhost"
            if url.hostname and not loopback:
                try:
                    loopback = ipaddress.ip_address(url.hostname).is_loopback
                except ValueError:
                    pass
            if (
                not url.hostname
                or url.username
                or url.password
                or url.query
                or url.fragment
                or url.path not in ("", "/")
                or url.scheme not in ("https", "http")
                or (url.scheme == "http" and not (allow_local_http and loopback))
                or any(ord(character) < 33 for character in origin)
                or not origin.isascii()
                or "\\" in origin
                or "%" in origin
                or not 0 < timeout <= 30
            ):
                raise ValueError
            _ = url.port
            if not loopback and not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", url.hostname):
                raise ValueError
        except (ValueError, TypeError):
            raise ApiError("INVALID_API_CONFIGURATION") from None
        self.resource = origin.rstrip("/") + "/api/integrations/v1"
        self._access_token = access_token
        self.timeout = timeout
        # TLS verification remains enabled; no environment/registry proxy or
        # redirect can route an Authorization header to an unapproved destination.
        self._opener = build_opener(ProxyHandler({}), _NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

    def _request(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            token = self._access_token()
            if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
                raise ValueError
        except ApiError:
            raise
        except Exception:
            raise ApiError("INTEGRATION_ACCESS_DENIED") from None
        try:
            body = None if payload is None else json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
            if body is not None and len(body) > MAX_RESPONSE_BYTES:
                raise ValueError
        except (ValueError, TypeError):
            raise ApiError("INVALID_INTEGRATION_INPUT") from None
        request = Request(
            self.resource + path,
            data=body,
            method="GET" if body is None else "POST",
            headers={
                "Authorization": "Bearer " + token,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "TradeOS-MT5/1",
            },
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                if response.status != 200:
                    raise ApiError("INVALID_API_RESPONSE")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES or response.headers.get_content_type() != "application/json":
                    raise ApiError("INVALID_API_RESPONSE")
                data = json.loads(
                    raw.decode("utf-8"), parse_constant=_reject_constant, object_pairs_hook=_unique_object
                )
                if not isinstance(data, dict):
                    raise ApiError("INVALID_API_RESPONSE")
                return data
        except HTTPError as error:
            status = error.code
            try:
                raw = error.read(MAX_RESPONSE_BYTES + 1)
                data = json.loads(raw.decode("utf-8")) if len(raw) <= MAX_RESPONSE_BYTES else {}
                code = data.get("error") if isinstance(data, dict) else None
            except (ValueError, UnicodeError, OSError):
                code = None
            finally:
                error.close()
            if 300 <= status < 400:
                raise ApiError("API_REDIRECT_DENIED") from None
            if status in (401, 403):
                raise ApiError("INTEGRATION_ACCESS_DENIED") from None
            if status == 429 or status >= 500:
                raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True) from None
            known = {
                "OPERATION_CONFLICT",
                "COLLECTOR_LEASE_HELD",
                "COLLECTOR_REQUIRES_ATTENTION",
                "INVALID_INTEGRATION_INPUT",
            }
            if isinstance(code, str) and code in known:
                raise ApiError(code, retryable=code == "COLLECTOR_LEASE_HELD") from None
            raise ApiError("COLLECTOR_REQUIRES_ATTENTION") from None
        except URLError as error:
            if isinstance(error.reason, ssl.SSLCertVerificationError):
                raise ApiError("TLS_VERIFICATION_FAILED") from None
            raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True) from None
        except (TimeoutError, OSError):
            raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True) from None
        except (ValueError, UnicodeError):
            raise ApiError("INVALID_API_RESPONSE") from None

    def verify_binding(self, binding: Binding, *, client_id: str | None = None) -> dict[str, Any]:
        return self.verify_account(binding.owner_id, binding.account_id, client_id=client_id)

    def verify_account(self, owner_id: str, account_id: str, *, client_id: str | None = None) -> dict[str, Any]:
        response = self._request("/session")
        actor = response.get("actor")
        if (
            response.get("version") != "v1"
            or not isinstance(actor, dict)
            or actor.get("user_id") != owner_id
            or actor.get("account_id") != account_id
            or actor.get("purpose") != "MT5"
            or actor.get("resource") != self.resource
            or (client_id is not None and actor.get("client_id") != client_id)
        ):
            raise ApiError("INTEGRATION_ACCOUNT_MISMATCH")
        return actor

    def acquire_lease(self, request: dict[str, Any]) -> dict[str, Any]:
        return lease_response(self._request("/mt5/lease", request), request["connectionId"])

    def capture(self, request: dict[str, Any]) -> dict[str, Any]:
        return capture_response(self._request("/mt5/capture", request), request["connectionId"])

    def operation(self, operation_id: str, connection_id: str) -> dict[str, Any]:
        operation_id = _uuid(operation_id)
        result = self._request("/operations/" + operation_id)
        if result.get("operationId") != operation_id:
            raise ApiError("INVALID_API_RESPONSE")
        if result.get("status") == "UNKNOWN" and set(result) == {"operationId", "status"}:
            return result
        if result.get("status") != "COMMITTED" or set(result) != {
            "operationId",
            "status",
            "kind",
            "createdAt",
            "result",
        }:
            raise ApiError("INVALID_API_RESPONSE")
        utc_response(result["createdAt"])
        if result["kind"] == "MT5_CAPTURE":
            return {**result, "result": capture_response(result["result"], connection_id)}
        if result["kind"] == "MT5_LEASE":
            return {**result, "result": lease_response(result["result"], connection_id)}
        raise ApiError("INVALID_API_RESPONSE")

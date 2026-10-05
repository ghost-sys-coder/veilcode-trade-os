"""Account-bound public-client PKCE and renewable Windows-protected credentials.

The application's session endpoint verifies signature, issuer, resource, expiry
and active grant before any new credential is persisted as usable. Local JWT
decoding is only a validation/expiry hint, never an authorization decision.
"""

import base64
import hashlib
import json
import re
import secrets
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request
from uuid import UUID, uuid5

from .api import ApiError, IntegrationApi
from .json_boundary import reject_constant as _reject_constant
from .json_boundary import unique_object as _unique_object
from .outbox import _uuid
from .windows_security import CredentialError, WindowsCredentialStore

VAULT_NAMESPACE = UUID("70c10954-79a9-4969-bc4c-5345e6e3dc51")
MAX_TOKEN_RESPONSE = 65_536


def _utc(value: datetime) -> str:
    if value.tzinfo is None:
        raise CredentialError("INVALID_OAUTH_CLOCK")
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _secret(value: Any) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 16384 or not re.fullmatch(r"[A-Za-z0-9._~+-]+", value):
        raise CredentialError("INVALID_OAUTH_RESPONSE")
    return value


def _callback(value: str):
    try:
        url = urlsplit(value)
        if (
            url.scheme != "http"
            or url.hostname != "127.0.0.1"
            or not url.port
            or not 1024 <= url.port <= 65535
            or url.username
            or url.password
            or url.fragment
            or url.path != "/callback"
        ):
            raise ValueError
        if not value.isascii() or "\\" in value or any(ord(c) < 33 for c in value):
            raise ValueError
        return url
    except (ValueError, TypeError):
        raise CredentialError("INVALID_OAUTH_CALLBACK") from None


@dataclass(frozen=True)
class OAuthConfiguration:
    issuer: str
    application_origin: str
    owner_id: str
    account_id: str
    client_id: str
    allow_local_http: bool = False

    def scope(self) -> dict[str, str]:
        issuer = urlsplit(self.issuer)
        if issuer.path != "/auth/v1" or issuer.query or issuer.fragment or self.issuer.endswith("/"):
            raise CredentialError("INVALID_OAUTH_CONFIGURATION")
        # Reuse the HTTPS/loopback/origin rules; no proxy or redirect downgrade.
        IntegrationApi(f"{issuer.scheme}://{issuer.netloc}", lambda: "", allow_local_http=self.allow_local_http)
        resource = IntegrationApi(self.application_origin, lambda: "", allow_local_http=self.allow_local_http).resource
        return {
            "issuer": self.issuer,
            "resource": resource,
            "ownerId": _uuid(self.owner_id),
            "accountId": _uuid(self.account_id),
            "clientId": _uuid(self.client_id),
        }


class OAuthClient:
    def __init__(self, configuration: OAuthConfiguration, *, store=None, now=lambda: datetime.now(UTC)):
        self.configuration = configuration
        self.scope = configuration.scope()
        self.context = "TradeOS:MT5:OAuth:v1:" + json.dumps(self.scope, sort_keys=True, separators=(",", ":"))
        self.store = store if store is not None else WindowsCredentialStore(str(uuid5(VAULT_NAMESPACE, self.context)))
        self.now = now
        issuer = urlsplit(configuration.issuer)
        self._http = IntegrationApi(
            f"{issuer.scheme}://{issuer.netloc}", lambda: "", allow_local_http=configuration.allow_local_http
        )

    def _request(self, path: str, form: dict[str, str] | None = None) -> dict:
        request = Request(
            self.configuration.issuer + path,
            data=None if form is None else urlencode(form).encode(),
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            method="GET" if form is None else "POST",
        )
        try:
            with self._http._opener.open(request, timeout=15) as response:
                raw = response.read(MAX_TOKEN_RESPONSE + 1)
                if (
                    response.status != 200
                    or len(raw) > MAX_TOKEN_RESPONSE
                    or response.headers.get_content_type() != "application/json"
                ):
                    raise CredentialError("INVALID_OAUTH_RESPONSE")
                result = json.loads(raw.decode(), parse_constant=_reject_constant, object_pairs_hook=_unique_object)
                if not isinstance(result, dict):
                    raise CredentialError("INVALID_OAUTH_RESPONSE")
                return result
        except HTTPError as error:
            status = error.code
            error.close()  # Never print/read provider error descriptions or secrets.
            raise CredentialError(
                "OAUTH_REDIRECT_DENIED" if 300 <= status < 400 else "OAUTH_REQUEST_REJECTED"
            ) from None
        except URLError as error:
            raise CredentialError(
                "OAUTH_TLS_FAILED"
                if isinstance(error.reason, ssl.SSLCertVerificationError)
                else "OAUTH_REQUEST_UNCERTAIN"
            ) from None
        except (OSError, ValueError, UnicodeError):
            raise CredentialError("OAUTH_REQUEST_UNCERTAIN") from None

    def discovery(self) -> None:
        metadata = self._request("/.well-known/openid-configuration")
        for key in (
            "code_challenge_methods_supported",
            "grant_types_supported",
            "token_endpoint_auth_methods_supported",
        ):
            if not isinstance(metadata.get(key), list) or not all(isinstance(value, str) for value in metadata[key]):
                raise CredentialError("OAUTH_COMPATIBILITY_GATE_FAILED")
        if (
            metadata.get("issuer") != self.configuration.issuer
            or metadata.get("authorization_endpoint") != self.configuration.issuer + "/oauth/authorize"
            or metadata.get("token_endpoint") != self.configuration.issuer + "/oauth/token"
            or "S256" not in metadata.get("code_challenge_methods_supported", [])
            or "authorization_code" not in metadata.get("grant_types_supported", [])
            or "refresh_token" not in metadata.get("grant_types_supported", [])
            or "none" not in metadata.get("token_endpoint_auth_methods_supported", [])
        ):
            raise CredentialError("OAUTH_COMPATIBILITY_GATE_FAILED")

    def begin(self, redirect_uri: str, *, reconnect: bool = False) -> str:
        callback = _callback(redirect_uri)
        if callback.query:
            raise CredentialError("INVALID_OAUTH_CALLBACK")
        self.discovery()
        with self.store.lock():
            if self.store.load(self.context) is not None and not reconnect:
                raise CredentialError("OAUTH_ALREADY_CONFIGURED")
            verifier, csrf = secrets.token_urlsafe(64), secrets.token_urlsafe(32)
            self.store.save(
                {
                    "state": "AUTHORIZING",
                    "verifier": verifier,
                    "csrf": csrf,
                    "redirectUri": redirect_uri,
                    "createdAt": _utc(self.now()),
                },
                self.context,
            )
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        return (
            self.configuration.issuer
            + "/oauth/authorize?"
            + urlencode(
                {
                    "client_id": self.scope["clientId"],
                    "response_type": "code",
                    "redirect_uri": redirect_uri,
                    "scope": "email",
                    "resource": self.scope["resource"],
                    "state": csrf,
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                }
            )
        )

    def _validated_record(self, response: dict, *, prior_refresh: str | None = None) -> dict:
        try:
            access = _secret(response.get("access_token"))
            refresh = _secret(response.get("refresh_token", prior_refresh))
        except CredentialError:
            raise CredentialError("OAUTH_RESPONSE_TOKENS_INVALID") from None
        if (
            not isinstance(response.get("token_type"), str)
            or response["token_type"].lower() != "bearer"
            or type(response.get("expires_in")) is not int
            or not 60 < response["expires_in"] <= 86400
        ):
            raise CredentialError("OAUTH_RESPONSE_LIFETIME_INVALID")
        try:
            parts = access.split(".")
            if len(parts) != 3:
                raise ValueError
            claims = json.loads(
                base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)),
                parse_constant=_reject_constant,
                object_pairs_hook=_unique_object,
            )
            if not isinstance(claims, dict):
                raise ValueError
            for key, expected in {
                "iss": self.scope["issuer"],
                "sub": self.scope["ownerId"],
                "client_id": self.scope["clientId"],
                "trade_os_resource": self.scope["resource"],
            }.items():
                if claims.get(key) != expected:
                    raise CredentialError("OAUTH_CLAIM_" + key.upper() + "_MISMATCH")
            audience = claims.get("aud")
            if not (
                audience == self.scope["resource"]
                or (
                    isinstance(audience, list)
                    and all(isinstance(item, str) for item in audience)
                    and self.scope["resource"] in audience
                )
            ):
                raise CredentialError("OAUTH_CLAIM_AUD_MISMATCH")
            if type(claims.get("exp")) is not int:
                raise ValueError
            now = self.now()
            _utc(now)
            expiry = min(datetime.fromtimestamp(claims["exp"], UTC), now + timedelta(seconds=response["expires_in"]))
            if expiry <= now + timedelta(seconds=60):
                raise ValueError
        except (ValueError, OverflowError, TypeError, KeyError, OSError):
            raise CredentialError("INVALID_OAUTH_RESPONSE") from None
        # This is the authoritative signature/live-grant check, not decoded claims.
        api = IntegrationApi(
            self.configuration.application_origin, lambda: access, allow_local_http=self.configuration.allow_local_http
        )
        actor = api.verify_account(
            self.scope["ownerId"],
            self.scope["accountId"],
            client_id=self.scope["clientId"],
        )
        return {
            "state": "READY",
            "accessToken": access,
            "refreshToken": refresh,
            "expiresAt": _utc(expiry),
            "grantId": _uuid(actor["grant_id"]),
        }

    def finish(self, callback_url: str) -> None:
        callback = _callback(callback_url)
        with self.store.lock():
            pending = self.store.load(self.context)
            if pending is None or pending.get("state") != "AUTHORIZING":
                raise CredentialError("OAUTH_REAUTHORIZATION_REQUIRED")
            try:
                query = parse_qs(callback.query, strict_parsing=True, keep_blank_values=True)
            except ValueError:
                raise CredentialError("INVALID_OAUTH_CALLBACK") from None
            if any(len(values) != 1 for values in query.values()) or set(query) - {
                "code",
                "state",
                "error",
                "error_description",
                "iss",
            }:
                raise CredentialError("INVALID_OAUTH_CALLBACK")
            if (
                callback_url.split("?", 1)[0] != pending["redirectUri"]
                or not secrets.compare_digest(query.get("state", [""])[0], pending["csrf"])
                or ("iss" in query and query["iss"][0] != self.configuration.issuer)
            ):
                raise CredentialError("INVALID_OAUTH_CALLBACK")
            created = datetime.fromisoformat(pending["createdAt"])
            now = self.now()
            if now < created or now - created > timedelta(minutes=10):
                raise CredentialError("OAUTH_REAUTHORIZATION_REQUIRED")
            if "error" in query:
                self.store.save({"state": "REAUTH_REQUIRED"}, self.context)
                raise CredentialError("OAUTH_CONSENT_DENIED")
            code = _secret(query.get("code", [None])[0])
            self.store.save({"state": "EXCHANGING"}, self.context)
            try:
                result = self._request(
                    "/oauth/token",
                    {
                        "grant_type": "authorization_code",
                        "client_id": self.scope["clientId"],
                        "redirect_uri": pending["redirectUri"],
                        "code_verifier": pending["verifier"],
                        "code": code,
                        "resource": self.scope["resource"],
                    },
                )
                record = self._validated_record(result)
                self.store.save(record, self.context)
            except (CredentialError, ApiError) as error:
                # One-use code may have been spent. Never fake a successful consent.
                self.store.save({"state": "REAUTH_REQUIRED"}, self.context)
                failure = CredentialError("OAUTH_REAUTHORIZATION_REQUIRED")
                failure.reason_code = error.code
                raise failure from None

    def access_token(self) -> str:
        with self.store.lock():
            record = self.store.load(self.context)
            if record is None or record.get("state") != "READY":
                raise CredentialError("OAUTH_REAUTHORIZATION_REQUIRED")
            try:
                expiry = datetime.fromisoformat(record["expiresAt"])
                if expiry.tzinfo is None:
                    raise ValueError
                _utc(self.now())
                access, refresh = _secret(record["accessToken"]), _secret(record["refreshToken"])
            except (ValueError, TypeError, KeyError):
                raise CredentialError("INVALID_CREDENTIAL_RECORD") from None
            if expiry > self.now() + timedelta(seconds=60):
                return access
            # Persist uncertainty before sending a possibly single-use refresh.
            # A crash/lost response cannot replay an old rotated token automatically.
            self.store.save({"state": "REFRESHING"}, self.context)
            try:
                response = self._request(
                    "/oauth/token",
                    {
                        "grant_type": "refresh_token",
                        "refresh_token": refresh,
                        "client_id": self.scope["clientId"],
                        "resource": self.scope["resource"],
                    },
                )
                updated = self._validated_record(response, prior_refresh=refresh)
                self.store.save(updated, self.context)
                return updated["accessToken"]
            except (CredentialError, ApiError):
                self.store.save({"state": "REAUTH_REQUIRED"}, self.context)
                raise CredentialError("OAUTH_REAUTHORIZATION_REQUIRED") from None

    def __call__(self) -> str:
        try:
            return self.access_token()
        except CredentialError as error:
            raise ApiError(error.code) from None

"""Strict public bootstrap activation. Importing configuration grants no access."""

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from trade_os_mt5.json_boundary import reject_constant, unique_object
from trade_os_mt5.outbox import OutboxError, _uuid
from trade_os_mt5.windows_security import CredentialError, SingleInstance, restrict_access

ISSUER = "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1"
APPLICATIONS = frozenset({"https://tradeos.veilcode.studio", "https://mcp-preview.veilcode.studio"})
PORT_CLIENTS = {"http://127.0.0.1:9878/callback": "CODEX", "http://127.0.0.1:9880/callback": "CLAUDE_CODE",
                "http://127.0.0.1:9882/callback": "GEMINI_CLI"}
CLIENT_LABELS = {"CODEX": "Codex", "CLAUDE_CODE": "Claude Code", "GEMINI_CLI": "Gemini CLI"}
MAX_PROFILES = 100


class SetupError(Exception):
    def __init__(self, code="INVALID_SETUP"):
        self.code = code
        super().__init__(code)


def local_path(path: Path) -> Path:
    """No remote/device/relative paths, junctions, symlinks or alternate streams."""
    path = Path(path)
    raw = str(path)
    if (not path.is_absolute() or raw.startswith(("\\\\", "//")) or any(ord(c) < 32 for c in raw)
            or any(c in raw for c in ('"', "<", ">", "|", "?", "*"))
            or (os.name == "nt" and (not re.fullmatch(r"[A-Za-z]:", path.drive) or ":" in raw[2:]))) :
        raise SetupError("UNSAFE_LOCAL_PATH")
    if any(part in (".", "..") or part.endswith((" ", ".")) for part in path.parts[1:]):
        raise SetupError("UNSAFE_LOCAL_PATH")
    if any(p.is_symlink() or (os.name == "nt" and p.is_junction()) for p in (path, *path.parents)):
        raise SetupError("UNSAFE_LOCAL_PATH")
    return path


def load_public_file(path: Path) -> dict:
    try:
        path = local_path(path)
        with path.open("rb") as handle:
            raw = handle.read(8193)
        if len(raw) > 8192:
            raise ValueError
        value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
        if not isinstance(value, dict):
            raise ValueError
        return value
    except SetupError:
        raise
    except (ValueError, TypeError, OSError):
        raise SetupError() from None


def bootstrap(value: dict) -> dict:
    """Reject credentials and untrusted endpoints before any file or network effect."""
    try:
        if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1:
            raise ValueError
        if value.get("format") == "trade-os-setup":
            if set(value) != {"format", "version", "purpose", "profileId", "ownerId", "account", "oauth"} or value["purpose"] != "MT5":
                raise ValueError
            profile, owner = _uuid(value["profileId"]), _uuid(value["ownerId"])
            account, oauth = value["account"], value["oauth"]
            if (not isinstance(account, dict) or set(account) != {"id", "name", "currencyCode", "currencyPrecision"}
                    or not isinstance(oauth, dict) or set(oauth) != {"issuer", "applicationOrigin", "clientId", "callbackUri", "allowLocalHttp"}):
                raise ValueError
            account_id, client = _uuid(account["id"]), _uuid(oauth["clientId"])
            if (oauth["issuer"] != ISSUER or oauth["applicationOrigin"] not in APPLICATIONS or oauth["allowLocalHttp"] is not False
                    or oauth["callbackUri"] != "http://127.0.0.1:9876/callback"
                    or not isinstance(account["name"], str) or not 1 <= len(account["name"].strip()) <= 200
                    or any(ord(c) < 32 for c in account["name"])
                    or not isinstance(account["currencyCode"], str) or not re.fullmatch(r"[A-Z]{3}", account["currencyCode"])
                    or type(account["currencyPrecision"]) is not int or not 0 <= account["currencyPrecision"] <= 20):
                raise ValueError
            return {"profileId": profile, "purpose": "MT5", "clientKind": "MT5_WINDOWS", "label": account["name"],
                    "ownerId": owner, "accountId": account_id, "clientId": client, "applicationOrigin": oauth["applicationOrigin"], "configuration": value}
        if set(value) != {"version", "profile", "resource", "issuer", "clientId", "redirectUri", "allowLoopback"}:
            raise ValueError
        if not isinstance(value["profile"], str) or not value["profile"].startswith("tradeos-"):
            raise ValueError
        profile, client = _uuid(value["profile"][8:]), _uuid(value["clientId"])
        resource = urlsplit(value["resource"])
        origin = f"{resource.scheme}://{resource.netloc}"
        if (origin not in APPLICATIONS or value["resource"] != origin + "/mcp" or value["issuer"] != ISSUER
                or value["allowLoopback"] is not False or value["redirectUri"] not in PORT_CLIENTS):
            raise ValueError
        kind = PORT_CLIENTS[value["redirectUri"]]
        return {"profileId": profile, "purpose": "MCP", "clientKind": kind, "label": CLIENT_LABELS[kind],
                "clientId": client, "applicationOrigin": origin, "configuration": value}
    except (ValueError, TypeError, KeyError, AttributeError, OutboxError):
        raise SetupError() from None


def canonical(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n").encode()


class Profiles:
    def __init__(self, root: Path):
        self.root = local_path(root)

    def _directory(self, profile_id: str) -> Path:
        return local_path(self.root / _uuid(profile_id))

    def import_file(self, path: Path) -> dict:
        checked = bootstrap(load_public_file(path))
        payload = canonical(checked["configuration"])
        self.root.mkdir(parents=True, exist_ok=True)
        restrict_access(self.root)
        with SingleInstance(self.root / "profiles.lock"):
            directory = self._directory(checked["profileId"])
            if not directory.exists() and sum(1 for entry in self.root.iterdir()
                                             if entry.is_dir() and re.fullmatch(r"[a-f0-9-]{36}", entry.name)) >= MAX_PROFILES:
                raise SetupError("PROFILE_LIMIT")
            directory.mkdir(exist_ok=True)
            restrict_access(directory)
            target = local_path(directory / "setup.json")
            if target.exists():
                existing = canonical(bootstrap(load_public_file(target))["configuration"])
                if existing != payload:
                    raise SetupError("PROFILE_CONFLICT")
            else:
                # Same-volume protected staging; never overwrite another profile.
                descriptor, name = tempfile.mkstemp(prefix="setup-", suffix=".tmp", dir=directory)
                temporary = local_path(Path(name))
                try:
                    restrict_access(temporary)
                    with os.fdopen(descriptor, "wb") as handle:
                        descriptor = None
                        handle.write(payload)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.link(temporary, target)  # Exclusive creation, including competing imports.
                    restrict_access(target)
                finally:
                    if descriptor is not None:
                        os.close(descriptor)
                    temporary.unlink(missing_ok=True)
        return self.summary(checked)

    def read(self, profile_id: str) -> dict:
        checked = bootstrap(load_public_file(self._directory(profile_id) / "setup.json"))
        if checked["profileId"] != _uuid(profile_id):
            raise SetupError("PROFILE_CONFLICT")
        return checked

    @staticmethod
    def summary(checked: dict) -> dict:
        return {key: checked[key] for key in ("profileId", "purpose", "clientKind", "label", "applicationOrigin")} | {
            "state": "CONFIGURED", "configurationHash": hashlib.sha256(canonical(checked["configuration"])).hexdigest()}

    def list(self) -> list[dict]:
        if not self.root.exists():
            return []
        local_path(self.root)
        result = []
        for directory in self.root.iterdir():
            if directory.is_dir() and re.fullmatch(r"[a-f0-9-]{36}", directory.name):
                result.append(self.summary(self.read(directory.name)))
                if len(result) > MAX_PROFILES:
                    raise SetupError("PROFILE_LIMIT")
        return sorted(result, key=lambda item: (item["label"], item["profileId"]))


def default_profiles() -> Profiles:
    root = os.environ.get("LOCALAPPDATA")
    if os.name != "nt" or not root:
        raise CredentialError("WINDOWS_PROTECTION_REQUIRED")
    return Profiles(local_path(Path(root)) / "TradeOS" / "companion" / "profiles")

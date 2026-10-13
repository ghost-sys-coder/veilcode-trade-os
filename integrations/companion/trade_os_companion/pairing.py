"""Explicit metadata-only terminal probe and server-verified PAUSED activation."""

import hashlib
import importlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

from trade_os_mt5 import source
from trade_os_mt5.api import IntegrationApi
from trade_os_mt5.broker import BrokerError, ReadOnlyTerminal, TerminalBinding, native_id
from trade_os_mt5.cli import load_configuration, perform, status
from trade_os_mt5.oauth import OAuthClient, OAuthConfiguration
from trade_os_mt5.outbox import _uuid
from trade_os_mt5.windows_security import SingleInstance, restrict_access

from .setup import SetupError, canonical, load_public_file, local_path


def client_api(profile):
    oauth = profile["configuration"]["oauth"]
    client = OAuthClient(OAuthConfiguration(oauth["issuer"], oauth["applicationOrigin"], profile["ownerId"],
                                          profile["accountId"], profile["clientId"], False))
    api = IntegrationApi(oauth["applicationOrigin"], client)
    api.verify_account(profile["ownerId"], profile["accountId"], client_id=profile["clientId"])
    return api


def write_new(path, value):
    path = local_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    restrict_access(path.parent)
    with path.open("xb") as handle:
        restrict_access(path)
        handle.write(canonical(value))
        handle.flush()
        os.fsync(handle.fileno())


def probe(profile, executable, portable, *, existing_manifest=None, module=None):
    if profile["purpose"] != "MT5" or type(portable) is not bool:
        raise SetupError("INVALID_ACTION")
    executable = local_path(Path(executable))
    if executable.name.lower() != "terminal64.exe" or not executable.is_file():
        raise SetupError("INVALID_TERMINAL")
    existing = None
    if existing_manifest is not None:
        existing = load_configuration(local_path(Path(existing_manifest)))
        if (existing.binding.owner_id != profile["ownerId"] or existing.binding.account_id != profile["accountId"]
                or existing.terminal.executable.resolve() != executable.resolve() or existing.terminal.portable != portable
                or status(existing)["mode"] != "PAUSED" or status(existing)["pendingPages"] != 0):
            raise SetupError("EXISTING_COLLECTOR_NOT_READY")
    if module is None:
        module = importlib.import_module("MetaTrader5")
    connected = False
    try:
        # Explicit approved installation only. Never login, switch accounts, read
        # trade history, enumerate installations or invoke any execution method.
        if module.initialize(str(executable.resolve()), timeout=15000, portable=portable) is not True:
            raise BrokerError("BROKER_CONNECT_UNAVAILABLE")
        connected = True
        terminal, account = module.terminal_info(), module.account_info()
        if terminal is None or account is None or terminal.connected is not True:
            raise BrokerError("BROKER_READ_UNAVAILABLE")
        data_path = local_path(Path(terminal.data_path))
        if not data_path.is_dir() or Path(terminal.path).resolve() != executable.resolve().parent:
            raise BrokerError("TERMINAL_INSTALLATION_MISMATCH")
        installation_id = (existing.terminal.identity["terminalInstallationId"] if existing else
                           str(uuid5(NAMESPACE_URL, "Trade OS terminal:" + str(executable.resolve()).casefold() + ":" + str(data_path.resolve()).casefold())))
        identity = {"server": account.server, "login": native_id(account.login), "terminalInstallationId": installation_id,
                    "currencyCode": account.currency, "currencyPrecision": account.currency_digits, "accountKind": "DEMO",
                    "positionMode": "HEDGING" if account.margin_mode == getattr(module, "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING", None) else "NETTING"}
        source.identity(identity)
        expected = profile["configuration"]["account"]
        if identity["currencyCode"] != expected["currencyCode"] or identity["currencyPrecision"] != expected["currencyPrecision"]:
            raise BrokerError("ACCOUNT_CURRENCY_MISMATCH")
        binding = TerminalBinding(executable.resolve(), data_path.resolve(), identity, True, portable)
        verifier = ReadOnlyTerminal(binding, module=module)
        verifier._verify_identity()  # Reuse the collector's full demo/mode/path validation.
        verifier._verify_identity()  # Account switches during the probe invalidate it.
        if existing and (existing.terminal.identity != identity or existing.terminal.data_path.resolve() != data_path.resolve()):
            raise BrokerError("MT5_ACCOUNT_IDENTITY_MISMATCH")
        return {"format": "trade-os-mt5-pairing", "version": 1, "profileId": profile["profileId"], "ownerId": profile["ownerId"],
                "accountId": profile["accountId"], "clientId": profile["clientId"],
                "observedAt": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "existingConnectionId": existing.binding.connection_id if existing else None,
                "terminal": {"executable": str(executable.resolve()), "dataPath": str(data_path.resolve()), "identity": identity,
                             "portable": portable, "dedicatedApproved": True}}
    finally:
        if connected:
            module.shutdown()  # Disconnect SDK only; no terminal process termination.


def prepare_probe(profiles, profile_id, executable, portable, existing_manifest):
    profile = profiles.read(profile_id)
    client_api(profile)  # Check account-bound application consent before SDK access.
    proposal = probe(profile, executable, portable, existing_manifest=existing_manifest)
    directory = profiles._directory(profile_id)
    with SingleInstance(profiles.root / "profiles.lock"):
        identifier = str(uuid4())
        proposal_path = directory / ("pairing-" + identifier + ".json")
        write_new(proposal_path, proposal)
        write_new(directory / ("pairing-" + identifier + ".local.json"), {"existingManifest": existing_manifest,
                  "previousHash": None if existing_manifest is None else hashlib.sha256(Path(existing_manifest).read_bytes()).hexdigest()})
    return {"proposalPath": str(proposal_path), "proposal": proposal}


def inspect_existing(profiles, profile_id, manifest_path):
    profile = profiles.read(profile_id)
    if profile["purpose"] != "MT5":
        raise SetupError("INVALID_ACTION")
    configuration = load_configuration(local_path(Path(manifest_path)))
    if configuration.binding.owner_id != profile["ownerId"] or configuration.binding.account_id != profile["accountId"]:
        raise SetupError("INVALID_PAIRING")
    current = status(configuration)
    if current["mode"] != "PAUSED" or current["pendingPages"] != 0:
        raise SetupError("EXISTING_COLLECTOR_NOT_READY")
    return {"executable": str(configuration.terminal.executable), "portable": configuration.terminal.portable,
            "connectionId": configuration.binding.connection_id}


def activate(profiles, profile_id, proposal_path, manifest_path):
    profile = profiles.read(profile_id)
    proposal_path = local_path(Path(proposal_path))
    directory = profiles._directory(profile_id)
    if proposal_path.parent != directory or not proposal_path.name.startswith("pairing-"):
        raise SetupError("INVALID_PAIRING")
    proposal = load_public_file(proposal_path)
    local_record = load_public_file(proposal_path.with_name(proposal_path.stem + ".local.json"))
    manifest = load_public_file(local_path(Path(manifest_path)))
    api = client_api(profile)
    approved = api._request("/mt5/pairing/" + profile_id)
    connection_id = _uuid(approved.get("connectionId"))
    if (approved.get("proposal") != proposal or manifest.get("terminal") != proposal["terminal"]
            or manifest.get("binding") != {"ownerId": profile["ownerId"], "accountId": profile["accountId"], "connectionId": approved.get("connectionId")}
            or manifest.get("oauth") != {key: profile["configuration"]["oauth"][key] for key in ("issuer", "applicationOrigin", "clientId", "allowLocalHttp")}
            or manifest.get("callbackUri") != profile["configuration"]["oauth"]["callbackUri"]
            or type(manifest.get("version")) is not int or manifest["version"] != 1
            or set(manifest) != {"version", "binding", "oauth", "terminal", "callbackUri"}):
        raise SetupError("INVALID_PAIRING")
    # Fresh demo/path/identity verification. Approved files cannot silently replace
    # terminal selection or fabricate historical planned values.
    observed = probe(profile, proposal["terminal"]["executable"], proposal["terminal"]["portable"],
                     existing_manifest=local_record["existingManifest"])
    if observed["terminal"] != proposal["terminal"] or observed["existingConnectionId"] != proposal["existingConnectionId"]:
        raise SetupError("INVALID_PAIRING")
    if local_record["existingManifest"] is None:
        target = local_path(profiles.root.parent / "connections" / connection_id / "connection.json")
        if target.exists():
            if json.loads(target.read_text()) != manifest:
                raise SetupError("PROFILE_CONFLICT")
        else:
            write_new(target, manifest)
        configuration = load_configuration(target)
        result = perform("init", configuration)
    else:
        target = local_path(Path(local_record["existingManifest"]))
        with SingleInstance(target.parent / "worker.lock"):
            existing = load_configuration(target)
            current = status(existing)
            if current["mode"] != "PAUSED" or current["pendingPages"] != 0:
                raise SetupError("EXISTING_COLLECTOR_NOT_READY")
            if canonical(json.loads(target.read_text())) != canonical(manifest):
                if hashlib.sha256(target.read_bytes()).hexdigest() != local_record["previousHash"]:
                    raise SetupError("PROFILE_CONFLICT")
                descriptor, name = tempfile.mkstemp(prefix="mapping-", suffix=".tmp", dir=target.parent)
                try:
                    restrict_access(Path(name))
                    with os.fdopen(descriptor, "wb") as handle:
                        descriptor = None
                        handle.write(canonical(manifest))
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(name, target)  # Explicit same-file adoption; spool is never rewritten.
                finally:
                    if descriptor is not None:
                        os.close(descriptor)
                    Path(name).unlink(missing_ok=True)
            configuration = load_configuration(target)
            result = status(configuration)
    if result["mode"] != "PAUSED":
        raise SetupError("EXISTING_COLLECTOR_NOT_READY")
    return {"state": "PAUSED", "connectionId": configuration.binding.connection_id, "manifestPath": str(target),
            "pendingPages": result["pendingPages"]}

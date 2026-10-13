"""Profile-bound operator controls. Never operate on a caller-selected process."""

import hashlib
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from trade_os_mt5.cli import load_configuration, perform, status
from trade_os_mt5.health import local_health
from trade_os_mt5.outbox import Outbox
from trade_os_mt5.startup import inspect, set_enabled
from trade_os_mt5.windows_security import SingleInstance

from .pairing import client_api, write_new
from .setup import SetupError, load_public_file, local_path


def remember(profiles, profile_id, target):
    path = profiles._directory(profile_id) / "collector.json"
    record = {"version": 1, "manifestPath": str(local_path(target)), "manifestHash": hashlib.sha256(target.read_bytes()).hexdigest()}
    with SingleInstance(profiles.root / "profiles.lock"):
        if path.exists():
            if load_public_file(path) != record:
                raise SetupError("PROFILE_CONFLICT")
        else:
            write_new(path, record)


def mapped(profiles, profile_id):
    profile = profiles.read(profile_id)
    if profile["purpose"] != "MT5":
        raise SetupError("INVALID_ACTION")
    record = load_public_file(profiles._directory(profile_id) / "collector.json")
    if set(record) != {"version", "manifestPath", "manifestHash"} or type(record["version"]) is not int or record["version"] != 1:
        raise SetupError("INVALID_PAIRING")
    path = local_path(Path(record["manifestPath"]))
    configuration = load_configuration(path)
    oauth = profile["configuration"]["oauth"]
    if (hashlib.sha256(path.read_bytes()).hexdigest() != record["manifestHash"]
            or configuration.binding.owner_id != profile["ownerId"] or configuration.binding.account_id != profile["accountId"]
            or configuration.oauth.client_id != profile["clientId"] or configuration.oauth.issuer != oauth["issuer"]
            or configuration.oauth.application_origin != oauth["applicationOrigin"] or configuration.oauth.allow_local_http
            or configuration.callback_uri != oauth["callbackUri"]):
        raise SetupError("PROFILE_CONFLICT")
    return profile, configuration


def snapshot(configuration):
    current = status(configuration)
    box = Outbox(configuration.spool, configuration.binding)
    try:
        health = local_health(configuration, box.runtime()["worker_id"])
    finally:
        box.close()
    return {**current, **health, "pausePending": current["mode"] == "PAUSED" and health["coordinatorActive"]
            and (health["localStale"] or health["observedState"] != "PAUSED")}


def verified(profile, configuration):
    approved = client_api(profile)._request("/mt5/pairing/" + profile["profileId"])
    if (approved.get("connectionId") != configuration.binding.connection_id
            or approved.get("proposal", {}).get("terminal") != load_public_file(configuration.path)["terminal"]):
        raise SetupError("INVALID_PAIRING")


def startup_change(profiles, profile_id, configuration, command, reason, work):
    # Append immutable intent before the OS mutation. A lost acknowledgement or
    # result-write failure remains visibly uncertain, never auto-retried.
    directory = profiles._directory(profile_id) / "control-audit"
    operation = str(uuid4())
    record = {"operationId": operation, "profileId": profile_id, "connectionId": configuration.binding.connection_id,
              "action": command, "reason": reason.strip(), "createdAt": datetime.now(UTC).isoformat(), "state": "REQUESTED"}
    write_new(directory / (operation + "-requested.json"), record)
    try:
        result = work()
    except Exception:
        write_new(directory / (operation + "-unconfirmed.json"), {**record, "state": "UNCONFIRMED"})
        raise
    write_new(directory / (operation + "-completed.json"), {**record, "state": "COMPLETED", "result": result})
    return result


def launch(configuration):
    """Hidden owned-package worker survives GUI close, without a shell or logs.

    Native IPC job permits child breakaway; coordinator lock and server fencing
    enforce ownership across this launch and separately approved startup tasks.
    Failure/unknown startup leaves PAUSED and never kills an unknown process.
    """
    interpreter = local_path(Path(sys.executable).resolve().with_name("pythonw.exe"))
    if not interpreter.is_file() or os.name != "nt":
        raise SetupError("STARTUP_INTERPRETER_UNAVAILABLE")
    environment = {key: value for key in ("SystemRoot", "WINDIR", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "TEMP", "TMP")
                   if (value := os.environ.get(key)) is not None}
    environment["PATH"] = str(interpreter.parent) + os.pathsep + str(Path(environment["SystemRoot"]) / "System32")
    subprocess.Popen([str(interpreter), "-B", "-I", "-m", "trade_os_mt5.cli", "run", "--config", str(configuration.path)],
                     cwd=interpreter.parent, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     env=environment, close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    # Only handshake on same-generation telemetry/lock; process creation is not
    # proof of collection, authorization, upload, publication or reconciliation.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        current = snapshot(configuration)
        if current["coordinatorActive"] and not current["localStale"]:
            return
        time.sleep(0.1)
    raise SetupError("WORKER_START_REQUIRES_INSPECTION")


def control(profiles, profile_id, command, *, reason=None):
    profile, configuration = mapped(profiles, profile_id)
    if command == "HEALTH":
        return snapshot(configuration)
    if command == "STARTUP_STATUS":
        return inspect(configuration)
    if command not in {"PAUSE", "START", "INSTALL_STARTUP", "REPAIR_STARTUP", "DISABLE_STARTUP"}:
        raise SetupError("INVALID_ACTION")
    if not isinstance(reason, str) or not 8 <= len(reason.strip()) <= 1000:
        raise SetupError("CONTROL_REASON_REQUIRED")
    with SingleInstance(configuration.path.parent / "companion-controls.lock"):
        if command == "PAUSE":
            perform("pause", configuration, reason=reason)
            return snapshot(configuration)  # Available offline, even after revocation.
        if command == "DISABLE_STARTUP":
            # Validate task before changing intent; pause does not interrupt a
            # bounded in-flight operation or destroy pending upload evidence.
            inspect(configuration, require_owned=True)
            def disable():
                perform("pause", configuration, reason=reason)
                return set_enabled(configuration, False)
            return startup_change(profiles, profile_id, configuration, command, reason, disable)
        verified(profile, configuration)  # Live app grant and current mapping.
        if command == "START":
            prior = snapshot(configuration)
            if prior["coordinatorActive"] and prior["localStale"]:
                raise SetupError("WORKER_STALLED_REQUIRES_INSPECTION")
            perform("resume", configuration, reason=reason)
            try:
                if not prior["coordinatorActive"]:
                    launch(configuration)
            except Exception:
                perform("pause", configuration, reason="Companion start unconfirmed; preserve pending uploads")
                raise
            return snapshot(configuration)
        # Register/repair is a separate explicit opt-in. No /Run, boot/SYSTEM
        # trigger or local resume. Existing intent is required to be PAUSED.
        if snapshot(configuration)["mode"] != "PAUSED":
            raise SetupError("PAUSE_BEFORE_STARTUP_CHANGE")
        return startup_change(profiles, profile_id, configuration, command, reason,
                              lambda: perform("repair-startup" if command == "REPAIR_STARTUP" else "install-startup", configuration, reason=reason))

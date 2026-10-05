"""Explicit local operator commands. No account discovery, switching or trading.

Reads a server-approved connection manifest; it does not grant server permissions.
Tokens live in the DPAPI vault, never config, stdout or command arguments.
"""

import argparse
import json
import os
import sqlite3
import sys
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from . import source
from .api import ApiError, IntegrationApi
from .broker import BrokerError, TerminalBinding
from .consent import authorize
from .coordinator import Coordinator
from .json_boundary import reject_constant, unique_object
from .oauth import OAuthClient, OAuthConfiguration, _callback
from .outbox import Binding, Outbox, OutboxError
from .startup import install as install_startup
from .startup import specification as startup_specification
from .supervisor import SupervisorError, _spool_path
from .windows_security import CredentialError, SingleInstance, restrict_access


@dataclass(frozen=True)
class OperatorConfiguration:
    binding: Binding
    terminal: TerminalBinding
    oauth: OAuthConfiguration
    callback_uri: str
    path: Path

    @property
    def spool(self):
        return self.path.parent / "outbox.sqlite3"


def load_configuration(path: Path) -> OperatorConfiguration:
    """Strict versioned manifest. Unknown keys (including credentials) rejected."""
    try:
        if (
            not path.is_absolute()
            or str(path).startswith("\\\\")
            or path.name != "connection.json"
            or path.is_symlink()
            or any(parent.is_symlink() or (os.name == "nt" and parent.is_junction()) for parent in path.parents)
        ):
            raise ValueError
        with path.open("rb") as handle:
            raw = handle.read(16385)
        if len(raw) > 16384:
            raise ValueError
        value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
        if not isinstance(value, dict) or set(value) != {"version", "binding", "oauth", "terminal", "callbackUri"}:
            raise ValueError
        if type(value["version"]) is not int or value["version"] != 1:
            raise ValueError
        binding, oauth, terminal = value["binding"], value["oauth"], value["terminal"]
        if (
            not isinstance(binding, dict)
            or set(binding) != {"ownerId", "accountId", "connectionId"}
            or not isinstance(oauth, dict)
            or set(oauth) != {"issuer", "applicationOrigin", "clientId", "allowLocalHttp"}
            or type(oauth["allowLocalHttp"]) is not bool
            or not isinstance(terminal, dict)
            or set(terminal) != {"executable", "dataPath", "identity", "dedicatedApproved", "portable"}
        ):
            raise ValueError
        approved = Binding(binding["ownerId"], binding["accountId"], binding["connectionId"]).normalized()
        if path.parent.name != approved.connection_id:
            raise ValueError
        source.identity(terminal["identity"])
        if terminal["dedicatedApproved"] is not True or type(terminal["portable"]) is not bool:
            raise ValueError
        executable, data = Path(terminal["executable"]), Path(terminal["dataPath"])
        if (
            not executable.is_absolute()
            or not data.is_absolute()
            or executable.name.lower() != "terminal64.exe"
            or str(executable).startswith("\\\\")
            or str(data).startswith("\\\\")
            or executable.is_symlink()
            or data.is_symlink()
            or any(
                parent.is_symlink() or (os.name == "nt" and parent.is_junction())
                for parent in (*executable.parents, *data.parents)
            )
        ):
            raise ValueError
        configuration = OAuthConfiguration(
            oauth["issuer"],
            oauth["applicationOrigin"],
            approved.owner_id,
            approved.account_id,
            oauth["clientId"],
            oauth["allowLocalHttp"],
        )
        configuration.scope()
        callback = _callback(value["callbackUri"])
        if callback.query:
            raise ValueError
        _spool_path(path.parent / "outbox.sqlite3", approved)
        return OperatorConfiguration(
            approved,
            TerminalBinding(executable, data, terminal["identity"], True, terminal["portable"]),
            configuration,
            value["callbackUri"],
            path,
        )
    except (ValueError, TypeError, KeyError, OSError, AttributeError, OutboxError, CredentialError, SupervisorError):
        raise CredentialError("INVALID_OPERATOR_CONFIGURATION") from None


def _instant():
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def status(configuration: OperatorConfiguration) -> dict:
    # Never silently create a new spool during inspection of a missing/corrupt one.
    if not configuration.spool.is_file():
        raise CredentialError("COLLECTOR_NOT_INITIALIZED")
    box = Outbox(configuration.spool, configuration.binding)
    try:
        state = box.runtime()
        captured, confirmed = box.checkpoints()
        last = state["last_contact_at"]
        now = datetime.now(UTC)
        contacted = datetime.fromisoformat(last) if last else None
        return {
            "connectionId": configuration.binding.connection_id,
            "mode": state["mode"],
            "code": state["attention_code"],
            "pendingPages": box.pending_count(),
            "captureCheckpoint": captured,
            "serverCheckpoint": confirmed,
            "lastContactAt": last,
            "stale": contacted is None or now < contacted or (now - contacted).total_seconds() >= 120,
        }
    finally:
        box.close()


def perform(command: str, configuration: OperatorConfiguration, *, reason=None, reconnect=False):
    if command == "startup-spec":
        return {"connectionId": configuration.binding.connection_id, "xml": startup_specification(configuration)}
    if command == "install-startup":
        return install_startup(configuration)
    if command == "status":
        return status(configuration)
    if command == "init":
        configuration.terminal.validate()
        restrict_access(configuration.path.parent)
        restrict_access(configuration.path)
        with SingleInstance(configuration.path.parent / "worker.lock"):
            box = Outbox(configuration.spool, configuration.binding)
            box.close()  # New defaults PAUSED; existing modes/history are preserved.
        return status(configuration)
    if command == "consent":
        authorize(OAuthClient(configuration.oauth), configuration.callback_uri, reconnect=reconnect)
        return {"connectionId": configuration.binding.connection_id, "consent": "APPROVED"}
    if command in ("pause", "resume"):
        if not isinstance(reason, str) or not 8 <= len(reason.strip()) <= 1000:
            raise CredentialError("CONTROL_REASON_REQUIRED")
        if not configuration.spool.is_file():
            raise CredentialError("COLLECTOR_NOT_INITIALIZED")
        if command == "resume":
            configuration.terminal.validate()
            api = IntegrationApi(
                configuration.oauth.application_origin,
                OAuthClient(configuration.oauth),
                allow_local_http=configuration.oauth.allow_local_http,
            )
            api.verify_account(
                configuration.binding.owner_id,
                configuration.binding.account_id,
                client_id=configuration.oauth.client_id,
            )
        box = Outbox(configuration.spool, configuration.binding)
        try:
            box.set_mode("PAUSED" if command == "pause" else "RUNNING", reason.strip(), _instant())
        finally:
            box.close()
        return status(configuration)
    if command == "run":
        if not configuration.spool.is_file():
            raise CredentialError("COLLECTOR_NOT_INITIALIZED")
        with Coordinator(
            configuration.binding, configuration.terminal, configuration.oauth, configuration.spool
        ) as worker:
            try:
                return worker.run_until_stopped(threading.Event())
            except KeyboardInterrupt:
                # Don't change durable intent; explicit pause stops future starts.
                return worker.status()
    raise CredentialError("INVALID_OPERATOR_COMMAND")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Trade OS read-only demo MT5 collector")
    parser.add_argument(
        "command", choices=("init", "consent", "run", "status", "pause", "resume", "startup-spec", "install-startup")
    )
    parser.add_argument("--config", required=True, type=Path, help="Absolute connection.json path (no credentials)")
    parser.add_argument("--reason", help="Required for pause/resume")
    parser.add_argument("--reconnect", action="store_true", help="Explicitly replace existing consent")
    args = parser.parse_args(argv)
    try:
        if (args.reason is not None and args.command not in ("pause", "resume")) or (
            args.reconnect and args.command != "consent"
        ):
            raise CredentialError("INVALID_OPERATOR_COMMAND")
        result = perform(args.command, load_configuration(args.config), reason=args.reason, reconnect=args.reconnect)
    except (CredentialError, ApiError, BrokerError, SupervisorError) as error:
        print(json.dumps({"kind": "ERROR", "code": error.code}), file=sys.stderr)
        return 1
    except (OutboxError, sqlite3.Error, OSError, ValueError, TypeError):
        print('{"kind":"ERROR","code":"COLLECTOR_REQUIRES_ATTENTION"}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('{"kind":"ERROR","code":"OPERATOR_CANCELLED"}', file=sys.stderr)
        return 130
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

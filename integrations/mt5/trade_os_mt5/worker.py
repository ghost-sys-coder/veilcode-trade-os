"""Fixed capture/upload subprocess entry point. No shell or execution commands.

Invoked only by the local supervisor with already approved terminal/mapping config.
CAPTURE stores a frozen collection; UPLOAD uses the live authenticated grant. An
operational coordinator must obtain a live lease before starting broker reads.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from .api import ApiError, IntegrationApi
from .broker import BrokerError, ReadOnlyTerminal, TerminalBinding
from .json_boundary import reject_constant, unique_object
from .oauth import OAuthClient, OAuthConfiguration
from .outbox import Binding, Outbox, OutboxError, _instant, _uuid
from .supervisor import ATTENTION_CODES, RETRYABLE_CODES, _spool_path
from .uploader import Uploader
from .windows_security import CredentialError, SingleInstance


def perform(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid worker configuration")
    action = payload.get("action")
    common = {"action", "binding", "spool"}
    if action == "CAPTURE":
        if set(payload) != common | {"terminal", "checkpoint", "fullHistory"}:
            raise ValueError("Unexpected worker configuration")
        terminal = payload["terminal"]
        if not isinstance(terminal, dict) or set(terminal) != {
            "executable",
            "dataPath",
            "identity",
            "dedicatedApproved",
            "portable",
        }:
            raise ValueError("Unexpected terminal configuration")
        if type(payload["fullHistory"]) is not bool:
            raise ValueError("Invalid collection configuration")
        if payload["checkpoint"] is not None:
            _instant(payload["checkpoint"])
        approved_terminal = TerminalBinding(
            Path(terminal["executable"]),
            Path(terminal["dataPath"]),
            terminal["identity"],
            terminal["dedicatedApproved"],
            terminal["portable"],
        )
        approved_terminal.validate()
    elif action == "UPLOAD":
        if set(payload) != common | {"oauth", "workerId"}:
            raise ValueError("Unexpected worker configuration")
        _uuid(payload["workerId"])
        configuration = OAuthConfiguration(**payload["oauth"])
        scope = configuration.scope()
    else:
        raise ValueError("Unknown worker action")
    binding = Binding(**payload["binding"]).normalized()
    if action == "UPLOAD" and (scope["ownerId"] != binding.owner_id or scope["accountId"] != binding.account_id):
        raise ValueError("Worker account mismatch")
    path = Path(_spool_path(Path(payload["spool"]), binding))
    if not path.parent.is_dir():
        raise ValueError("Approved spool directory required")
    with SingleInstance(path.parent / "worker.lock"):
        box = Outbox(path, binding)
        try:
            if action == "CAPTURE":
                reader = ReadOnlyTerminal(approved_terminal)
                try:
                    reader.connect()
                    capture = reader.collect(
                        now=datetime.now(UTC), checkpoint=payload["checkpoint"], full_history=payload["fullHistory"]
                    )
                    collection = box.enqueue(capture.identity, capture.checkpoint, capture.pages)
                    return {
                        "kind": "CAPTURED",
                        "connectionId": binding.connection_id,
                        "collectionId": collection,
                        "checkpoint": capture.checkpoint,
                        "pendingPages": box.pending_count(),
                    }
                finally:
                    reader.close()
            if action == "UPLOAD":
                api = IntegrationApi(
                    configuration.application_origin,
                    OAuthClient(configuration),
                    allow_local_http=configuration.allow_local_http,
                )
                uploader = Uploader(api, box, payload["workerId"])
                uploader.ensure_lease()  # Heartbeat/revocation checks also when idle.
                uploader.upload_one()
                captured, confirmed = box.checkpoints()
                return {
                    "kind": "UPLOADED",
                    "connectionId": binding.connection_id,
                    "pendingPages": box.pending_count(),
                    "captureCheckpoint": captured,
                    "serverCheckpoint": confirmed,
                    "leaseExpiresAt": uploader.lease["leaseExpiresAt"],
                }
            raise ValueError("Unknown worker action")
        finally:
            box.close()


def main():
    try:
        encoded = sys.stdin.buffer.read(32769)
        if len(encoded) > 32768:
            raise ValueError("Worker configuration too large")
        payload = json.loads(encoded, parse_constant=reject_constant, object_pairs_hook=unique_object)
        result = perform(payload)
    except (BrokerError, ApiError, CredentialError) as error:
        code = error.code if error.code in RETRYABLE_CODES | ATTENTION_CODES else "WORKER_REQUIRES_ATTENTION"
        result = {"kind": "ERROR", "code": code}
    except OutboxError:
        result = {"kind": "ERROR", "code": "OUTBOX_REQUIRES_ATTENTION"}
    except Exception:
        result = {"kind": "ERROR", "code": "WORKER_REQUIRES_ATTENTION"}
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()

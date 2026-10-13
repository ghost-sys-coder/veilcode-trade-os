"""Protected local observations, not proof of authorization or reconciliation."""

import json
import os
import re
import tempfile
from datetime import UTC, datetime

from .json_boundary import reject_constant, unique_object
from .outbox import OutboxError, _instant, _uuid
from .windows_security import CredentialError, SingleInstance, restrict_access


def observe(worker):
    state = worker.status()
    value = {"version": 1, "connectionId": worker.binding.connection_id, "workerId": worker.worker_id,
             "observedAt": worker._utc(worker.now().astimezone(UTC)), "state": state["state"], "code": state["code"]}
    path = worker.spool.parent / "collector-health.json"
    descriptor, name = tempfile.mkstemp(prefix="health-", suffix=".tmp", dir=path.parent)
    try:
        restrict_access(type(path)(name))
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(json.dumps(value, separators=(",", ":"), allow_nan=False).encode())
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        type(path)(name).unlink(missing_ok=True)


def local_health(configuration, worker_id, *, now=None):
    """A held OS lock and a recent same-generation tick are separate signals.

    Never kill a PID or remove a lock to recover. Missing/invalid observations
    remain unknown, including pre-companion coordinators holding the lock.
    """
    active = False
    with_lock = None
    try:
        with_lock = SingleInstance(configuration.path.parent / "collector.lock")
    except CredentialError as error:
        if error.code != "COLLECTOR_ALREADY_RUNNING":
            raise
        active = True
    finally:
        if with_lock is not None:
            with_lock.close()
    result = {"coordinatorActive": active, "observedAt": None, "localStale": True, "observedState": None, "retryCode": None}
    try:
        path = configuration.path.parent / "collector-health.json"
        if path.is_symlink() or path.is_junction():
            return result
        with path.open("rb") as handle:
            raw = handle.read(8193)
        if len(raw) > 8192:
            return result
        value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
        if (set(value) != {"version", "connectionId", "workerId", "observedAt", "state", "code"}
                or type(value["version"]) is not int or value["version"] != 1
                or value["connectionId"] != configuration.binding.connection_id or _uuid(value["workerId"]) != worker_id
                or value["state"] not in ("RUNNING", "RETRYING", "PAUSED", "ATTENTION")
                or (value["code"] is not None and (not isinstance(value["code"], str) or not re.fullmatch(r"[A-Z0-9_]{1,80}", value["code"])))):
            return result
        stamp = datetime.fromisoformat(_instant(value["observedAt"]))
        age = ((now or datetime.now(UTC)) - stamp).total_seconds()
        return {**result, "observedAt": value["observedAt"], "localStale": not active or not 0 <= age < 120,
                "observedState": value["state"], "retryCode": value["code"]}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OutboxError):
        return result

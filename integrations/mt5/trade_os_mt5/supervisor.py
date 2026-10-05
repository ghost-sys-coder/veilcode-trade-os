"""Bounded owned-worker processes; never terminate a MetaTrader terminal.

This process boundary can supervise capture and HTTP/refresh work. Continuous
scheduling, operator pause/resume and Task Scheduler installation are separate.
"""

import json
import os
import subprocess
import sys
import threading
from dataclasses import asdict
from pathlib import Path

from .broker import TerminalBinding
from .json_boundary import reject_constant, unique_object
from .oauth import OAuthConfiguration
from .outbox import Binding, OutboxError, _instant, _uuid
from .windows_process import OwnedWorkerJob, ProcessProtectionError


class SupervisorError(Exception):
    def __init__(self, code: str, *, retryable: bool = False):
        self.code, self.retryable = code, retryable
        super().__init__(code)


def _worker_command() -> list[str]:
    # Startup uses pythonw to keep the coordinator hidden. Workers need the
    # sibling console interpreter for their bounded stdin/stdout protocol.
    interpreter = Path(sys.executable).resolve()
    if os.name == "nt" and interpreter.name.lower() == "pythonw.exe":
        interpreter = interpreter.with_name("python.exe")
        if not interpreter.is_file():
            raise SupervisorError("WORKER_START_FAILED", retryable=True)
    return [str(interpreter), "-m", "trade_os_mt5.worker"]


RETRYABLE_CODES = {
    "BROKER_READ_UNAVAILABLE",
    "BROKER_CONNECT_UNAVAILABLE",
    "INTEGRATION_UNAVAILABLE",
    "COLLECTOR_LEASE_HELD",
}
ATTENTION_CODES = {
    "MT5_ACCOUNT_IDENTITY_MISMATCH",
    "DEMO_ACCOUNT_REQUIRED",
    "TERMINAL_INSTALLATION_MISMATCH",
    "UNSUPPORTED_POSITION_MODE",
    "INVALID_BROKER_IDENTITY",
    "INVALID_BROKER_FACT",
    "DUPLICATE_BROKER_FACT",
    "UNAPPROVED_TERMINAL_CONFIGURATION",
    "METATRADER_PACKAGE_REQUIRED",
    "UNSUPPORTED_POSITION_TYPE",
    "INVALID_BROKER_ENUM",
    "INVALID_BROKER_TIMESTAMP",
    "INVALID_BROKER_IDENTIFIER",
    "INVALID_COLLECTION_WINDOW",
    "INTEGRATION_ACCESS_DENIED",
    "INTEGRATION_ACCOUNT_MISMATCH",
    "OPERATION_CONFLICT",
    "COLLECTOR_REQUIRES_ATTENTION",
    "TLS_VERIFICATION_FAILED",
    "INVALID_API_RESPONSE",
    "OAUTH_REAUTHORIZATION_REQUIRED",
    "INVALID_CREDENTIAL_RECORD",
    "CREDENTIAL_PROTECTION_FAILED",
    "CREDENTIAL_STORE_UNAVAILABLE",
    "CREDENTIAL_PERMISSIONS_FAILED",
    "COLLECTOR_ALREADY_RUNNING",
    "OUTBOX_REQUIRES_ATTENTION",
    "WORKER_REQUIRES_ATTENTION",
    "WORKER_SUPERVISION_UNAVAILABLE",
}


def _run_process(command: list[str], payload: dict, *, timeout: float = 45) -> dict:
    """Private test seam. Public adapters below always use one fixed module."""
    if type(timeout) not in (int, float) or not 0 < timeout <= 120 or not isinstance(payload, dict):
        raise SupervisorError("INVALID_WORKER_CONFIGURATION")
    try:
        encoded = json.dumps(payload, allow_nan=False).encode()
        if len(encoded) > 32768:
            raise ValueError
    except (ValueError, TypeError):
        raise SupervisorError("INVALID_WORKER_CONFIGURATION") from None
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (ValueError, OSError, TypeError):
        raise SupervisorError("WORKER_START_FAILED", retryable=True) from None
    output = bytearray()
    overflow = threading.Event()
    io_failed = threading.Event()

    def kill_owned():
        # poll/kill is racy when the child exits simultaneously. Never substitute
        # a name-based kill or a PID not obtained from this Popen instance.
        if process.poll() is None:
            try:
                process.kill()
            except OSError:
                if process.poll() is None:
                    raise SupervisorError("WORKER_TERMINATION_REQUIRES_ATTENTION") from None

    def terminate_owned():
        kill_owned()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            raise SupervisorError("WORKER_TERMINATION_REQUIRES_ATTENTION") from None

    def write_input():
        try:
            process.stdin.write(encoded)
            process.stdin.flush()
        except (OSError, ValueError):
            io_failed.set()
        finally:
            try:
                process.stdin.close()
            except (OSError, ValueError):
                pass

    def read_output():
        try:
            while chunk := process.stdout.read1(1024):
                if len(output) + len(chunk) > 4096:
                    overflow.set()
                    kill_owned()
                    break
                output.extend(chunk)
        except (OSError, ValueError, SupervisorError):
            io_failed.set()

    writer = threading.Thread(target=write_input, daemon=True)
    reader = threading.Thread(target=read_output, daemon=True)
    timed_out = False
    protection = None
    try:
        if os.name == "nt" and process.poll() is None:
            try:
                protection = OwnedWorkerJob(process.pid)
            except ProcessProtectionError:
                raise SupervisorError("WORKER_SUPERVISION_UNAVAILABLE") from None
        # Assign the job before sending input; no broker/API work can start in
        # the fixed worker until its complete payload arrives.
        writer.start()
        reader.start()
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            terminate_owned()
    except BaseException:
        # Includes Ctrl+C: never abandon the child or release the coordinator
        # lock while an owned capture process could still write to its spool.
        terminate_owned()
        raise
    finally:
        if protection is not None:
            protection.close()  # OS also closes this if the supervisor is killed.
        if writer.ident is not None:
            writer.join(1)
        if reader.ident is not None:
            reader.join(1)
        if writer.is_alive() or reader.is_alive():
            # Do not keep restarting if inherited handles prevent cleanup.
            raise SupervisorError("WORKER_HANDLE_RECOVERY_REQUIRED")
        process.stdout.close()
        if not process.stdin.closed:
            process.stdin.close()
    if timed_out:
        raise SupervisorError("WORKER_STALLED", retryable=True)
    if overflow.is_set() or io_failed.is_set():
        raise SupervisorError("INVALID_WORKER_RESPONSE")
    if process.returncode != 0:
        raise SupervisorError("WORKER_CRASHED", retryable=True)
    try:
        result = json.loads(output, parse_constant=reject_constant, object_pairs_hook=unique_object)
        if not isinstance(result, dict):
            raise ValueError
    except (ValueError, UnicodeError):
        raise SupervisorError("INVALID_WORKER_RESPONSE") from None
    if result.get("kind") == "ERROR":
        if set(result) != {"kind", "code"}:
            raise SupervisorError("INVALID_WORKER_RESPONSE")
        code = result.get("code")
        if not isinstance(code, str) or code not in RETRYABLE_CODES | ATTENTION_CODES:
            code = "WORKER_REQUIRES_ATTENTION"
        raise SupervisorError(code, retryable=code in RETRYABLE_CODES)
    return result


def _spool_path(path: Path, binding: Binding) -> str:
    if (
        not path.is_absolute()
        or str(path).startswith("\\\\")
        or path.name != "outbox.sqlite3"
        or path.parent.name != binding.connection_id
        or path.is_symlink()
        or path.parent.is_symlink()
        or any(parent.is_symlink() or (os.name == "nt" and parent.is_junction()) for parent in path.parents)
    ):
        raise SupervisorError("INVALID_WORKER_CONFIGURATION")
    return str(path.resolve())


def supervised_capture(
    binding: Binding,
    terminal: TerminalBinding,
    spool: Path,
    *,
    checkpoint: str | None = None,
    full_history: bool = False,
    timeout: float = 45,
) -> dict:
    binding = binding.normalized()
    terminal.validate()
    if type(full_history) is not bool:
        raise SupervisorError("INVALID_WORKER_CONFIGURATION")
    try:
        if checkpoint is not None:
            _instant(checkpoint)
    except OutboxError:
        raise SupervisorError("INVALID_WORKER_CONFIGURATION") from None
    payload = {
        "action": "CAPTURE",
        "binding": asdict(binding),
        "spool": _spool_path(spool, binding),
        "terminal": {
            "executable": str(terminal.executable),
            "dataPath": str(terminal.data_path),
            "identity": terminal.identity,
            "dedicatedApproved": terminal.dedicated_approved,
            "portable": terminal.portable,
        },
        "checkpoint": checkpoint,
        "fullHistory": full_history,
    }
    result = _run_process(_worker_command(), payload, timeout=timeout)
    if (
        set(result) != {"kind", "connectionId", "collectionId", "checkpoint", "pendingPages"}
        or result["kind"] != "CAPTURED"
        or result["connectionId"] != binding.connection_id
        or type(result["pendingPages"]) is not int
        or result["pendingPages"] < 1
    ):
        raise SupervisorError("INVALID_WORKER_RESPONSE")
    try:
        _uuid(result["collectionId"])
        _instant(result["checkpoint"])
    except OutboxError:
        raise SupervisorError("INVALID_WORKER_RESPONSE") from None
    return result


def supervised_upload(
    binding: Binding, configuration: OAuthConfiguration, spool: Path, worker_id: str, *, timeout: float = 45
) -> dict:
    binding = binding.normalized()
    scope = configuration.scope()
    if binding.owner_id != scope["ownerId"] or binding.account_id != scope["accountId"]:
        raise SupervisorError("INVALID_WORKER_CONFIGURATION")
    payload = {
        "action": "UPLOAD",
        "binding": asdict(binding),
        "spool": _spool_path(spool, binding),
        "oauth": asdict(configuration),
        "workerId": _uuid(worker_id),
    }
    result = _run_process(_worker_command(), payload, timeout=timeout)
    if (
        set(result)
        != {"kind", "connectionId", "pendingPages", "captureCheckpoint", "serverCheckpoint", "leaseExpiresAt"}
        or result["kind"] != "UPLOADED"
        or result["connectionId"] != binding.connection_id
        or type(result["pendingPages"]) is not int
        or result["pendingPages"] < 0
    ):
        raise SupervisorError("INVALID_WORKER_RESPONSE")
    try:
        _instant(result["leaseExpiresAt"])
        for key in ("captureCheckpoint", "serverCheckpoint"):
            if result[key] is not None:
                _instant(result[key])
    except OutboxError:
        raise SupervisorError("INVALID_WORKER_RESPONSE") from None
    return result

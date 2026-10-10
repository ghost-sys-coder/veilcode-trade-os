"""Private IPC only: reuse the existing Windows vault, never the MT5 terminal.

Hold the OS lock for the Node adapter's lifetime so rotating refresh tokens
cannot race between clients sharing a profile. Tokens never appear in argv/logs.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mt5"))
from trade_os_mt5.json_boundary import reject_constant, unique_object  # noqa: E402
from trade_os_mt5.windows_security import CredentialError, WindowsCredentialStore  # noqa: E402


def read_request():
    line = sys.stdin.buffer.readline(131_074)
    if not line:
        return None
    if len(line) > 131_073 or not line.endswith(b"\n"):
        raise CredentialError("INVALID_CREDENTIAL_RECORD")
    return json.loads(line, parse_constant=reject_constant, object_pairs_hook=unique_object)


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n")
    sys.stdout.flush()


def main():
    init = read_request()
    if not isinstance(init, dict) or set(init) != {"id", "context"}:
        raise CredentialError("INVALID_CREDENTIAL_RECORD")
    context = init["context"]
    if not isinstance(context, str) or not context.startswith("Trade OS MCP credentials v1\n") or len(context) > 4096:
        raise CredentialError("INVALID_CREDENTIAL_RECORD")
    store = WindowsCredentialStore(init["id"])
    with store.lock():
        emit({"ready": True})
        while (request := read_request()) is not None:
            if request == {"action": "load"}:
                emit({"payload": store.load(context)})
            elif isinstance(request, dict) and set(request) == {"action", "payload"} and request["action"] == "save":
                store.save(request["payload"], context)
                emit({"saved": True})
            elif request == {"action": "clear"}:
                # Atomically replace encrypted credentials, do not remove audit/grants.
                store.save({"disconnected": True}, context)
                emit({"cleared": True})
            else:
                raise CredentialError("INVALID_CREDENTIAL_RECORD")


if __name__ == "__main__":
    try:
        main()
    except CredentialError as error:
        emit({"error": "PROFILE_BUSY" if error.code == "COLLECTOR_ALREADY_RUNNING" else "VAULT_UNAVAILABLE"})
        sys.exit(1)
    except Exception:
        emit({"error": "VAULT_UNAVAILABLE"})
        sys.exit(1)

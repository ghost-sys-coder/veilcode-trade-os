"""Local-only real-provider fixture. Private token IPC is captured by Node.

Never invoke for hosted accounts. No broker import or connection. Credentials
on disk are DPAPI-protected disposable fixture artifacts, removed by the runner.
"""

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid5

from .api import ApiError, IntegrationApi
from .oauth import VAULT_NAMESPACE, OAuthClient, OAuthConfiguration
from .outbox import Binding, Outbox
from .supervisor import SupervisorError, supervised_upload
from .windows_security import CredentialError, WindowsCredentialStore, restrict_access


def main():
    data = json.loads(sys.stdin.read(65536))
    for value in (data["issuer"], data["origin"]):
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
            raise ValueError("Disposable loopback fixture required")
    configuration = OAuthConfiguration(
        data["issuer"], data["origin"], data["ownerId"], data["accountId"], data["clientId"], True
    )
    context = "TradeOS:MT5:OAuth:v1:" + json.dumps(configuration.scope(), sort_keys=True, separators=(",", ":"))
    vault = str(uuid5(VAULT_NAMESPACE, context))
    directory = Path(data["directory"])
    store = WindowsCredentialStore(vault, _test_directory=directory / "TradeOS" / "credentials")
    client = OAuthClient(configuration, store=store)
    action = data["action"]
    if action == "begin":
        print(json.dumps({"authorizationUrl": client.begin(data["redirectUri"], reconnect=data.get("reconnect", False))}))
        return
    if action == "finish":
        client.finish(data["callbackUrl"])
    elif action == "refresh":
        with store.lock():
            record = store.load(client.context)
            assert record["state"] == "READY"
            # Controlled fixture expiry, not an expiry override in application code.
            record["expiresAt"] = datetime.now(UTC).isoformat()
            store.save(record, client.context)
        client.access_token()
    elif action == "revoked":
        api = IntegrationApi(data["origin"], client, allow_local_http=True)
        try:
            api.verify_account(data["ownerId"], data["accountId"], client_id=data["clientId"])
        except ApiError as error:
            assert error.code == "INTEGRATION_ACCESS_DENIED"
            print(json.dumps({"revoked": True}))
            return
        raise AssertionError("Revoked token accepted")
    elif action == "workerUpload":
        binding = Binding(data["ownerId"], data["accountId"], data["connectionId"]).normalized()
        spool = directory / binding.connection_id / "outbox.sqlite3"
        spool.parent.mkdir(exist_ok=True)
        restrict_access(spool.parent)
        box = Outbox(spool, binding)
        try:
            box.enqueue(data["identity"], data["checkpoint"], [[data["event"]]])
        finally:
            box.close()
        # Isolate only this fixture process and its owned children. The real
        # worker locates the default vault with no test hook in application code.
        previous = os.environ.get("LOCALAPPDATA")
        os.environ["LOCALAPPDATA"] = str(directory)
        try:
            result = supervised_upload(binding, configuration, spool, data["workerId"])
            assert result["pendingPages"] == 0 and result["serverCheckpoint"] is not None
            # A second actual process reloads the same encrypted credentials/spool.
            assert supervised_upload(binding, configuration, spool, data["workerId"])["pendingPages"] == 0
        finally:
            if previous is None:
                del os.environ["LOCALAPPDATA"]
            else:
                os.environ["LOCALAPPDATA"] = previous
        print(json.dumps({"pendingPages": 0, "serverCheckpoint": result["serverCheckpoint"]}))
        return
    else:
        raise ValueError("Unknown fixture action")
    with store.lock():
        record = store.load(client.context)
    cipher = store.path.read_bytes()
    assert record["accessToken"].encode() not in cipher and record["refreshToken"].encode() not in cipher
    # Only private subprocess IPC; the runner never logs this payload.
    print(
        json.dumps({"access_token": record["accessToken"], "refresh_token": record["refreshToken"], "encrypted": True})
    )


if __name__ == "__main__":
    try:
        main()
    except (CredentialError, ApiError, SupervisorError) as error:
        allowed = {
            "INVALID_OAUTH_RESPONSE",
            "INTEGRATION_ACCOUNT_MISMATCH",
            "INTEGRATION_ACCESS_DENIED",
            "INTEGRATION_UNAVAILABLE",
            "OAUTH_REQUEST_REJECTED",
            "OAUTH_REQUEST_UNCERTAIN",
            "OAUTH_REAUTHORIZATION_REQUIRED",
            "INVALID_OAUTH_CALLBACK",
            "CREDENTIAL_STORE_UNAVAILABLE",
            "CREDENTIAL_PROTECTION_FAILED",
            "OAUTH_COMPATIBILITY_GATE_FAILED",
        }
        allowed.update(
            {
                "OAUTH_RESPONSE_TOKENS_INVALID",
                "OAUTH_RESPONSE_LIFETIME_INVALID",
                "OAUTH_CLAIM_ISS_MISMATCH",
                "OAUTH_CLAIM_SUB_MISMATCH",
                "OAUTH_CLAIM_CLIENT_ID_MISMATCH",
                "OAUTH_CLAIM_AUD_MISMATCH",
                "OAUTH_CLAIM_TRADE_OS_RESOURCE_MISMATCH",
            }
        )
        code = getattr(error, "reason_code", error.code)
        print(
            "Local Python OAuth fixture failed: " + (code if code in allowed else "VALIDATION_REJECTED"),
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except Exception:
        print("Local Python OAuth fixture failed; credential details suppressed.", file=sys.stderr)
        raise SystemExit(1) from None

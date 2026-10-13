"""Fixed GUI IPC. No caller-selected commands, runtime paths or credential output."""

import json
import sys
from pathlib import Path

from trade_os_mt5.api import ApiError, IntegrationApi
from trade_os_mt5.broker import BrokerError
from trade_os_mt5.consent import authorize
from trade_os_mt5.json_boundary import reject_constant, unique_object
from trade_os_mt5.oauth import OAuthClient, OAuthConfiguration
from trade_os_mt5.windows_security import CredentialError

from .setup import SetupError, default_profiles


def perform(request: dict) -> dict:
    if not isinstance(request, dict):
        raise SetupError()
    profiles = default_profiles()
    if (set(request) == {"action", "profileId"} and request["action"] in ("HEALTH", "STARTUP_STATUS")):
        from .controls import control
        return control(profiles, request["profileId"], request["action"])
    if (set(request) == {"action", "profileId", "reason"} and request["action"] in
            ("PAUSE", "START", "INSTALL_STARTUP", "REPAIR_STARTUP", "DISABLE_STARTUP")):
        from .controls import control
        return control(profiles, request["profileId"], request["action"], reason=request["reason"])
    if (set(request) == {"action", "profileId", "manifestPath"} and request["action"] == "INSPECT_EXISTING"
            and isinstance(request["manifestPath"], str)):
        from .pairing import inspect_existing
        return inspect_existing(profiles, request["profileId"], request["manifestPath"])
    if (set(request) == {"action", "profileId", "executable", "portable", "existingManifest", "dedicatedApproved"}
            and request["action"] == "PROBE" and request["dedicatedApproved"] is True
            and isinstance(request["executable"], str) and type(request["portable"]) is bool
            and (request["existingManifest"] is None or isinstance(request["existingManifest"], str))):
        from .pairing import prepare_probe
        return prepare_probe(profiles, request["profileId"], request["executable"], request["portable"], request["existingManifest"])
    if (set(request) == {"action", "profileId", "proposalPath", "manifestPath"} and request["action"] == "ACTIVATE"
            and isinstance(request["proposalPath"], str) and isinstance(request["manifestPath"], str)):
        from .pairing import activate
        return activate(profiles, request["profileId"], request["proposalPath"], request["manifestPath"])
    if request == {"action": "LIST"}:
        return {"profiles": profiles.list()}
    if set(request) == {"action", "path"} and request["action"] == "IMPORT" and isinstance(request["path"], str):
        return {"profile": profiles.import_file(Path(request["path"]))}
    if set(request) == {"action", "profileId"} and request["action"] == "READ":
        return {"profile": profiles.summary(profiles.read(request["profileId"]))}
    if set(request) == {"action", "profileId", "reconnect"} and request["action"] == "CONSENT" and type(request["reconnect"]) is bool:
        profile = profiles.read(request["profileId"])
        if profile["purpose"] != "MT5":
            raise SetupError("INVALID_ACTION")
        oauth = profile["configuration"]["oauth"]
        client = OAuthClient(OAuthConfiguration(oauth["issuer"], oauth["applicationOrigin"], profile["ownerId"],
                                              profile["accountId"], profile["clientId"], False))
        authorize(client, oauth["callbackUri"], reconnect=request["reconnect"])
        return {"profileId": profile["profileId"], "state": "AUTHORIZED"}
    if set(request) == {"action", "profileId"} and request["action"] == "VERIFY_ACCESS":
        profile = profiles.read(request["profileId"])
        if profile["purpose"] != "MT5":
            raise SetupError("INVALID_ACTION")
        oauth = profile["configuration"]["oauth"]
        client = OAuthClient(OAuthConfiguration(oauth["issuer"], oauth["applicationOrigin"], profile["ownerId"],
                                              profile["accountId"], profile["clientId"], False))
        IntegrationApi(oauth["applicationOrigin"], client).verify_account(profile["ownerId"], profile["accountId"], client_id=profile["clientId"])
        return {"profileId": profile["profileId"], "state": "AUTHORIZED"}
    raise SetupError("INVALID_ACTION")


def main():
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise SetupError()
        request = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
        result = perform(request)
        print(json.dumps(result, separators=(",", ":"), allow_nan=False))
        return 0
    except (SetupError, CredentialError, ApiError, BrokerError) as error:
        print(json.dumps({"error": error.code}, separators=(",", ":")))
    except Exception:
        print('{"error":"COMPANION_UNAVAILABLE"}')
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

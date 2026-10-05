"""Disposable local API fault fixture; tokens arrive via stdin, never files/args.

No terminal import/connection. Only the controlled example.test owner/connection
created by the Node OAuth verification runner may be used for this fixture.
"""

import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from .api import ApiError, IntegrationApi
from .outbox import Binding, Outbox
from .uploader import Uploader


def main() -> None:
    data = json.loads(sys.stdin.read(32_768))
    url = urlsplit(data["origin"])
    if url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Local fixture required")
    binding = Binding(data["ownerId"], data["accountId"], data["connectionId"])
    box = Outbox(Path(data["spoolPath"]), binding)
    try:

        class LostAcknowledgementApi(IntegrationApi):
            def capture(self, request):
                super().capture(request)
                raise ApiError("INTEGRATION_UNAVAILABLE", retryable=True)

        api_type = LostAcknowledgementApi if data["action"] == "capture_lost_ack" else IntegrationApi
        api = api_type(data["origin"], lambda: data["accessToken"], allow_local_http=True)
        uploader = Uploader(api, box, data["workerId"])
        action = data["action"]
        if action in ("capture_lost_ack", "prepare_uncommitted"):
            box.enqueue(data["identity"], data["checkpoint"], [[data["event"]]])
        if action == "prepare_uncommitted":
            lease = uploader.ensure_lease()
            request = box.next_attempt(data["workerId"], lease["fencingToken"])
            assert request is not None
            operation_id = request["operationId"]
        elif action == "capture_lost_ack":
            try:
                uploader.upload_one()
                raise AssertionError("Fault not injected")
            except ApiError as error:
                assert error.code == "INTEGRATION_UNAVAILABLE"
            request = box.uncertain_attempt()
            assert request is not None
            operation_id = request["operationId"]
        elif action == "recover":
            request = box.uncertain_attempt()
            assert request is not None
            operation_id = request["operationId"]
            assert uploader.upload_one()
        else:
            raise ValueError("Unknown fixture action")
        capture_checkpoint, server_checkpoint = box.checkpoints()
        print(
            json.dumps(
                {
                    "pending": box.pending_count(),
                    "operationId": operation_id,
                    "captureCheckpoint": capture_checkpoint,
                    "serverCheckpoint": server_checkpoint,
                }
            )
        )
    finally:
        box.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Local Python API fault fixture failed; details suppressed.", file=sys.stderr)
        raise SystemExit(1) from None

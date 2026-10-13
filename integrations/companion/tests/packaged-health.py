"""Test-only bounded PAUSED worker. Never packaged, authorized or broker-connected."""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from trade_os_companion.controls import snapshot
from trade_os_mt5.cli import load_configuration, perform
from trade_os_mt5.coordinator import Coordinator


def run():
    configuration = load_configuration(Path(sys.argv[2]))
    if sys.argv[1] == "worker":
        stop = threading.Event()
        timer = threading.Timer(6, stop.set)
        with Coordinator(configuration.binding, configuration.terminal, configuration.oauth, configuration.spool) as worker:
            timer.start()
            try:
                worker.run_until_stopped(stop)
            finally:
                timer.cancel()
        return
    perform("init", configuration)
    process = subprocess.Popen([sys.executable, "-I", __file__, "worker", str(configuration.path)],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        current = snapshot(configuration)
        if current["coordinatorActive"] and not current["localStale"]:
            if current["mode"] != "PAUSED" or current["pendingPages"] != 0 or current["lastContactAt"] is not None:
                raise RuntimeError("Fixture unexpectedly active")
            print(json.dumps({"pid": process.pid, "fixtureParent": os.getpid(), "mode": current["mode"]}))
            return
        time.sleep(0.05)
    raise RuntimeError("Fixture handshake not observed")


if __name__ == "__main__":
    run()

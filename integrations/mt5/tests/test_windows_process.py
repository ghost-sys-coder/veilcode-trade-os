import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import unittest
from ctypes import wintypes
from pathlib import Path
from tempfile import TemporaryDirectory


@unittest.skipUnless(os.name == "nt", "Native Windows process containment")
class WindowsProcessTests(unittest.TestCase):
    def test_supervisor_death_kills_worker_but_not_its_breakaway_child(self):
        # Both worker and terminal stand-in are controlled Python fixtures; no
        # installed MetaTrader, user process or process-name enumeration involved.
        child_code = """import json,os,subprocess,sys,time
from pathlib import Path
p=json.load(sys.stdin)
standin=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
Path(p['marker']).write_text(json.dumps({'worker':os.getpid(),'standin':standin.pid}))
time.sleep(60)
"""
        host_code = """import json,sys
from trade_os_mt5.supervisor import _run_process
p=json.load(sys.stdin)
_run_process([sys.executable,'-c',p['code']],{'marker':p['marker']},timeout=60)
"""
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = (
            [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD],
            wintypes.HANDLE,
        )
        kernel.WaitForSingleObject.argtypes, kernel.WaitForSingleObject.restype = (
            [wintypes.HANDLE, wintypes.DWORD],
            wintypes.DWORD,
        )
        kernel.TerminateProcess.argtypes, kernel.TerminateProcess.restype = (
            [wintypes.HANDLE, wintypes.UINT],
            wintypes.BOOL,
        )
        kernel.CloseHandle.argtypes, kernel.CloseHandle.restype = [wintypes.HANDLE], wintypes.BOOL
        worker_handle = standin_handle = None
        with TemporaryDirectory(prefix="trade-os-job-test-") as temporary:
            marker = Path(temporary) / "owned-processes.json"
            host = subprocess.Popen(
                [sys.executable, "-c", host_code],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            try:
                host.stdin.write(json.dumps({"code": child_code, "marker": str(marker)}).encode())
                host.stdin.close()
                deadline = time.monotonic() + 5
                while not marker.exists() and host.poll() is None and time.monotonic() < deadline:
                    threading.Event().wait(0.02)
                self.assertTrue(marker.exists(), "Owned worker must start under the native guard")
                ids = json.loads(marker.read_text())
                worker_handle = kernel.OpenProcess(0x00100001, False, ids["worker"])
                standin_handle = kernel.OpenProcess(0x00100001, False, ids["standin"])
                self.assertTrue(worker_handle and standin_handle)
                host.kill()  # Exact test-owned supervisor; closes its job handle.
                host.wait(timeout=5)
                self.assertEqual(kernel.WaitForSingleObject(worker_handle, 5000), 0)
                self.assertEqual(kernel.WaitForSingleObject(standin_handle, 0), 258)  # Still running, not in this job.
            finally:
                if host.poll() is None:
                    host.kill()
                host.wait(timeout=5)
                for handle in (worker_handle, standin_handle):
                    if handle:
                        if kernel.WaitForSingleObject(handle, 0) == 258:
                            kernel.TerminateProcess(handle, 1)  # Only the handle captured for our controlled fixture.
                            kernel.WaitForSingleObject(handle, 5000)
                        kernel.CloseHandle(handle)


if __name__ == "__main__":
    unittest.main()

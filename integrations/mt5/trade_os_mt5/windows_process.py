"""Contain only the owned Python worker if its supervisor dies.

Children silently break away from this job: a terminal started by initialize
must not be terminated when we stop Python. No process discovery/name killing.
The unnamed job handle is deliberately not inherited by the worker.
"""

import ctypes
import os
from ctypes import wintypes


class ProcessProtectionError(Exception):
    pass


class _BasicLimits(ctypes.Structure):
    _fields_ = [
        ("ProcessTime", ctypes.c_longlong),
        ("JobTime", ctypes.c_longlong),
        ("Flags", wintypes.DWORD),
        ("MinimumWorkingSet", ctypes.c_size_t),
        ("MaximumWorkingSet", ctypes.c_size_t),
        ("ActiveProcesses", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("Priority", wintypes.DWORD),
        ("Scheduling", wintypes.DWORD),
    ]


class _IoCounters(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_ulonglong)
        for name in ("ReadOperations", "WriteOperations", "OtherOperations", "ReadBytes", "WriteBytes", "OtherBytes")
    ]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("Basic", _BasicLimits),
        ("Io", _IoCounters),
        ("ProcessMemory", ctypes.c_size_t),
        ("JobMemory", ctypes.c_size_t),
        ("PeakProcessMemory", ctypes.c_size_t),
        ("PeakJobMemory", ctypes.c_size_t),
    ]


class OwnedWorkerJob:
    def __init__(self, pid: int):
        if os.name != "nt" or type(pid) is not int or pid <= 0:
            raise ProcessProtectionError("WORKER_SUPERVISION_UNAVAILABLE")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes, kernel.CreateJobObjectW.restype = (
            [ctypes.c_void_p, wintypes.LPCWSTR],
            wintypes.HANDLE,
        )
        kernel.SetInformationJobObject.argtypes, kernel.SetInformationJobObject.restype = (
            [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD],
            wintypes.BOOL,
        )
        kernel.AssignProcessToJobObject.argtypes, kernel.AssignProcessToJobObject.restype = (
            [wintypes.HANDLE, wintypes.HANDLE],
            wintypes.BOOL,
        )
        kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = (
            [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD],
            wintypes.HANDLE,
        )
        kernel.CloseHandle.argtypes, kernel.CloseHandle.restype = [wintypes.HANDLE], wintypes.BOOL
        self.kernel, self.handle = kernel, kernel.CreateJobObjectW(None, None)
        process = None
        try:
            if not self.handle:
                raise ProcessProtectionError("WORKER_SUPERVISION_UNAVAILABLE")
            limits = _ExtendedLimits()
            limits.Basic.Flags = 0x2000 | 0x1000  # KILL_ON_JOB_CLOSE + SILENT_BREAKAWAY_OK
            if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ProcessProtectionError("WORKER_SUPERVISION_UNAVAILABLE")
            process = kernel.OpenProcess(0x0100 | 0x0001, False, pid)  # SET_QUOTA + TERMINATE, exact owned PID.
            if not process or not kernel.AssignProcessToJobObject(self.handle, process):
                raise ProcessProtectionError("WORKER_SUPERVISION_UNAVAILABLE")
        except BaseException:
            self.close()
            raise
        finally:
            if process:
                kernel.CloseHandle(process)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None

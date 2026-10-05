"""User-scoped Windows protection and file locking; never machine-wide secrets.

Only encrypted bytes reach disk. Native temporary buffers are cleared; Python
immutable strings/bytes cannot be guaranteed to be erased from process memory.
"""

import ctypes
import hashlib
import json
import os
import tempfile
from ctypes import wintypes
from pathlib import Path
from typing import Any

from .json_boundary import reject_constant, unique_object
from .outbox import _uuid


class CredentialError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class _Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes):
    buffer = ctypes.create_string_buffer(data)
    return _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def _windows_dlls():
    if os.name != "nt":
        raise CredentialError("WINDOWS_PROTECTION_REQUIRED")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes, kernel.LocalFree.restype = [ctypes.c_void_p], ctypes.c_void_p
    return kernel, ctypes.WinDLL("crypt32", use_last_error=True), ctypes.WinDLL("advapi32", use_last_error=True)


def protect(data: bytes, context: str, *, decrypt: bool = False) -> bytes:
    if not isinstance(data, bytes) or not 0 < len(data) <= 131_072 or not isinstance(context, str) or not context:
        raise CredentialError("INVALID_CREDENTIAL_RECORD")
    kernel, crypt, _ = _windows_dlls()
    source, source_buffer = _blob(data)
    entropy, entropy_buffer = _blob(hashlib.sha256(context.encode()).digest())
    target = _Blob()
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [
        ctypes.POINTER(_Blob),
        ctypes.c_void_p,
        ctypes.POINTER(_Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(_Blob),
    ]
    function.restype = wintypes.BOOL
    try:
        # UI forbidden; deliberately no CRYPTPROTECT_LOCAL_MACHINE flag.
        if not function(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(target)):
            raise CredentialError("CREDENTIAL_PROTECTION_FAILED")
        if not target.data or not 0 < target.size <= 131_072:
            raise CredentialError("INVALID_CREDENTIAL_RECORD")
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.memset(source_buffer, 0, len(source_buffer))
        ctypes.memset(entropy_buffer, 0, len(entropy_buffer))
        if target.data:
            ctypes.memset(target.data, 0, target.size)
            kernel.LocalFree(target.data)


def _current_sid(kernel, advapi) -> str:
    token = wintypes.HANDLE()
    kernel.GetCurrentProcess.argtypes, kernel.GetCurrentProcess.restype = [], wintypes.HANDLE
    kernel.CloseHandle.argtypes, kernel.CloseHandle.restype = [wintypes.HANDLE], wintypes.BOOL
    advapi.OpenProcessToken.argtypes, advapi.OpenProcessToken.restype = (
        [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)],
        wintypes.BOOL,
    )
    advapi.GetTokenInformation.argtypes, advapi.GetTokenInformation.restype = (
        [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)],
        wintypes.BOOL,
    )
    advapi.ConvertSidToStringSidW.argtypes, advapi.ConvertSidToStringSidW.restype = (
        [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)],
        wintypes.BOOL,
    )
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
    sid_string = ctypes.c_void_p()
    try:
        needed = wintypes.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))
        if not 0 < needed.value <= 65536:
            raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
        information = ctypes.create_string_buffer(needed.value)
        if not advapi.GetTokenInformation(token, 1, information, needed, ctypes.byref(needed)):
            raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
        sid = ctypes.cast(information, ctypes.POINTER(ctypes.c_void_p))[0]
        if not advapi.ConvertSidToStringSidW(sid, ctypes.byref(sid_string)):
            raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
        return ctypes.wstring_at(sid_string)
    finally:
        if sid_string:
            kernel.LocalFree(sid_string)
        kernel.CloseHandle(token)


def restrict_access(path: Path) -> None:
    """Replace this task-owned object's DACL with current-user/SYSTEM only."""
    kernel, _, advapi = _windows_dlls()
    sid = _current_sid(kernel, advapi)
    inheritance = "OICI" if path.is_dir() else ""
    descriptor = ctypes.c_void_p()
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    advapi.GetSecurityDescriptorDacl.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.BOOL),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.BOOL),
    ]
    advapi.GetSecurityDescriptorDacl.restype = wintypes.BOOL
    advapi.SetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR,
        ctypes.c_int,
        wintypes.DWORD,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    advapi.SetNamedSecurityInfoW.restype = wintypes.DWORD
    try:
        sddl = f"D:P(A;{inheritance};FA;;;{sid})(A;{inheritance};FA;;;SY)"
        if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None):
            raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
        present, defaulted, dacl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        if (
            not advapi.GetSecurityDescriptorDacl(
                descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)
            )
            or not present
        ):
            raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
        if advapi.SetNamedSecurityInfoW(str(path), 1, 4 | 0x80000000, None, None, dacl, None) != 0:
            raise CredentialError("CREDENTIAL_PERMISSIONS_FAILED")
    finally:
        if descriptor:
            kernel.LocalFree(descriptor)


class SingleInstance:
    """OS-owned lock, released on process death; do not delete lock files."""

    def __init__(self, path: Path):
        if os.name != "nt":
            raise CredentialError("WINDOWS_PROTECTION_REQUIRED")
        import msvcrt

        try:
            if path.is_symlink():
                raise CredentialError("INVALID_CREDENTIAL_DIRECTORY")
            self._file = path.open("a+b")
        except OSError:
            raise CredentialError("CREDENTIAL_STORE_UNAVAILABLE") from None
        try:
            self._file.seek(0, 2)
            if self._file.tell() == 0:
                self._file.write(b"\0")
                self._file.flush()
                os.fsync(self._file.fileno())
        except OSError:
            self._file.close()
            raise CredentialError("CREDENTIAL_STORE_UNAVAILABLE") from None
        try:
            self._file.seek(0)
            msvcrt.locking(self._file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            self._file.close()
            raise CredentialError("COLLECTOR_ALREADY_RUNNING") from None

    def close(self):
        if not self._file.closed:
            import msvcrt

            try:
                self._file.seek(0)
                msvcrt.locking(self._file.fileno(), msvcrt.LK_UNLCK, 1)
            finally:
                self._file.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class WindowsCredentialStore:
    def __init__(self, vault_id: str, *, _test_directory: Path | None = None):
        if os.name != "nt":
            raise CredentialError("WINDOWS_PROTECTION_REQUIRED")
        vault_id = _uuid(vault_id)
        if _test_directory is None:
            root = Path(os.environ.get("LOCALAPPDATA", ""))
            if not root.is_absolute():
                raise CredentialError("INVALID_CREDENTIAL_DIRECTORY")
            directory = root / "TradeOS" / "credentials"
        else:
            directory = _test_directory
        if (
            not directory.is_absolute()
            or str(directory).startswith("\\\\")
            or directory.is_symlink()
            or directory.is_junction()
            or any(parent.is_symlink() or parent.is_junction() for parent in directory.parents)
        ):
            raise CredentialError("INVALID_CREDENTIAL_DIRECTORY")
        directory.mkdir(parents=True, exist_ok=True)
        restrict_access(directory)
        self.directory = directory.resolve()
        self.path = self.directory / (vault_id + ".dpapi")
        self.lock_path = self.directory / (vault_id + ".lock")

    def lock(self):
        return SingleInstance(self.lock_path)

    def load(self, context: str) -> dict[str, Any] | None:
        try:
            if not self.path.exists():
                return None
            if self.path.is_symlink():
                raise CredentialError("INVALID_CREDENTIAL_RECORD")
            with self.path.open("rb") as handle:
                encrypted = handle.read(131_073)
            plaintext = protect(encrypted, context, decrypt=True)
            record = json.loads(plaintext, parse_constant=reject_constant, object_pairs_hook=unique_object)
            payload = record["payload"]
            encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
            if not isinstance(payload, dict) or record != {
                "version": 1,
                "payload": payload,
                "digest": hashlib.sha256(encoded).hexdigest(),
            }:
                raise CredentialError("INVALID_CREDENTIAL_RECORD")
            return payload
        except CredentialError:
            raise
        except (OSError, ValueError, KeyError, TypeError):
            raise CredentialError("CREDENTIAL_STORE_UNAVAILABLE") from None

    def save(self, payload: dict[str, Any], context: str) -> None:
        temporary = None
        try:
            if not isinstance(payload, dict) or self.path.is_symlink():
                raise CredentialError("INVALID_CREDENTIAL_RECORD")
            encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
            envelope = json.dumps(
                {"version": 1, "payload": payload, "digest": hashlib.sha256(encoded).hexdigest()},
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode()
            encrypted = protect(envelope, context)
            descriptor, name = tempfile.mkstemp(prefix=".rotate-", dir=self.directory)
            temporary = Path(name)
            with os.fdopen(descriptor, "wb") as handle:
                restrict_access(temporary)
                handle.write(encrypted)
                handle.flush()
                os.fsync(handle.fileno())
            kernel, _, _ = _windows_dlls()
            kernel.MoveFileExW.argtypes, kernel.MoveFileExW.restype = (
                [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD],
                wintypes.BOOL,
            )
            # Same-volume replacement and write-through; old record survives failure.
            if not kernel.MoveFileExW(str(temporary), str(self.path), 1 | 8):
                raise CredentialError("CREDENTIAL_STORE_UNAVAILABLE")
            temporary = None
        except CredentialError:
            raise
        except (OSError, ValueError, TypeError):
            raise CredentialError("CREDENTIAL_STORE_UNAVAILABLE") from None
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)  # Only our exact encrypted temp file.
                except OSError:
                    raise CredentialError("CREDENTIAL_STORE_UNAVAILABLE") from None

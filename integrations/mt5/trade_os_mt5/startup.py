"""Current-user, sign-in Task Scheduler registration; never overwrites a task.

No passwords, boot trigger, SYSTEM execution, account switching or shell.
Registration does not start a collector or change its durable PAUSED intent.
"""

import ctypes
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from ctypes import wintypes
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .windows_security import CredentialError, _current_sid, _windows_dlls, restrict_access

NAMESPACE = "http://schemas.microsoft.com/windows/2004/02/mit/task"
ET.register_namespace("", NAMESPACE)


def _principal_sid(account):
    if isinstance(account,str) and re.fullmatch(r"S-1-5-21-(?:[0-9]+-){2}[0-9]+-[0-9]+",account):
        return account
    if not isinstance(account,str) or not 1<=len(account)<=256 or any(ord(c)<32 for c in account):
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    kernel,_,advapi=_windows_dlls()
    advapi.LookupAccountNameW.argtypes=[wintypes.LPCWSTR,wintypes.LPCWSTR,ctypes.c_void_p,ctypes.POINTER(wintypes.DWORD),
        wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD),ctypes.POINTER(wintypes.DWORD)]
    advapi.LookupAccountNameW.restype=wintypes.BOOL
    size,domain_size,use=wintypes.DWORD(),wintypes.DWORD(),wintypes.DWORD()
    advapi.LookupAccountNameW(None,account,None,ctypes.byref(size),None,ctypes.byref(domain_size),ctypes.byref(use))
    if not 0<size.value<=65536 or not 0<domain_size.value<=4096:
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    sid,domain=ctypes.create_string_buffer(size.value),ctypes.create_unicode_buffer(domain_size.value)
    if not advapi.LookupAccountNameW(None,account,sid,ctypes.byref(size),domain,ctypes.byref(domain_size),ctypes.byref(use)):
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    string=ctypes.c_void_p()
    advapi.ConvertSidToStringSidW.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_void_p)]
    advapi.ConvertSidToStringSidW.restype=wintypes.BOOL
    if not advapi.ConvertSidToStringSidW(sid,ctypes.byref(string)):
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    try:
        return ctypes.wstring_at(string)
    finally:
        kernel.LocalFree(string)


def task_xml(configuration, *, user_sid: str, python_executable: Path, working_directory: Path) -> str:
    if not re.fullmatch(r"S-1-5-21-(?:[0-9]+-){2}[0-9]+-[0-9]+", user_sid):
        raise CredentialError("INVALID_STARTUP_CONFIGURATION")
    for path in (configuration.path, python_executable, working_directory):
        if (
            not path.is_absolute()
            or str(path).startswith("\\\\")
            or any(ord(character) < 32 or character == '"' for character in str(path))
        ):
            raise CredentialError("INVALID_STARTUP_CONFIGURATION")
    task = ET.Element("{" + NAMESPACE + "}Task", {"version": "1.3"})

    def element(parent, name, text=None, **attributes):
        child = ET.SubElement(parent, "{" + NAMESPACE + "}" + name, attributes)
        child.text = text
        return child

    registration = element(task, "RegistrationInfo")
    element(registration, "Description", "Trade OS read-only demo MT5 collector " + configuration.binding.connection_id)
    triggers = element(task, "Triggers")
    trigger = element(triggers, "LogonTrigger")
    element(trigger, "Enabled", "true")
    element(trigger, "UserId", user_sid)
    element(trigger, "Delay", "PT15S")
    # Observed Windows builds may not retry a force-terminated action. A timed
    # watchdog also recovers coordinator death; IgnoreNew + the native lock
    # prevent competing collectors. InteractiveToken still requires user sign-in.
    watchdog = element(triggers, "TimeTrigger")
    repetition = element(watchdog, "Repetition")
    element(repetition, "Interval", "PT1M")
    element(repetition, "StopAtDurationEnd", "false")
    element(watchdog, "StartBoundary", (datetime.now(UTC) + timedelta(seconds=30)).isoformat(timespec="seconds"))
    element(watchdog, "Enabled", "true")
    principals = element(task, "Principals")
    principal = element(principals, "Principal", id="TradeOSUser")
    element(principal, "UserId", user_sid)
    element(principal, "LogonType", "InteractiveToken")
    element(principal, "RunLevel", "LeastPrivilege")
    settings = element(task, "Settings")
    for key, value in (
        ("MultipleInstancesPolicy", "IgnoreNew"),
        ("DisallowStartIfOnBatteries", "false"),
        ("StopIfGoingOnBatteries", "false"),
        ("StartWhenAvailable", "true"),
        ("AllowHardTerminate", "true"),
        ("Enabled", "true"),
        ("Hidden", "true"),
        ("ExecutionTimeLimit", "PT0S"),
    ):
        element(settings, key, value)
    restart = element(settings, "RestartOnFailure")
    element(restart, "Interval", "PT1M")
    element(restart, "Count", "10")
    actions = element(task, "Actions", Context="TradeOSUser")
    execute = element(actions, "Exec")
    element(execute, "Command", str(python_executable))
    # No shell interpretation. list2cmdline quotes the exact Windows argv.
    element(
        execute,
        "Arguments",
        subprocess.list2cmdline(
            [
                "-m",
                "trade_os_mt5.cli",
                "run",
                "--config",
                str(configuration.path),
            ]
        ),
    )
    element(execute, "WorkingDirectory", str(working_directory))
    # No byte-encoding declaration on a Unicode XML document: the same XML is
    # consumed as UTF-16 BSTR by native validation and UTF-8 bytes by schtasks.
    return ET.tostring(task, encoding="unicode")


def specification(configuration) -> str:
    kernel, _, advapi = _windows_dlls()
    interpreter = Path(sys.executable).resolve().with_name("pythonw.exe")
    if not interpreter.is_file():
        raise CredentialError("STARTUP_INTERPRETER_UNAVAILABLE")
    return task_xml(
        configuration,
        user_sid=_current_sid(kernel, advapi),
        python_executable=interpreter,
        working_directory=Path(__file__).resolve().parent.parent,
    )


def _scheduler():
    if os.name != "nt":
        raise CredentialError("WINDOWS_PROTECTION_REQUIRED")
    system_root = Path(os.environ.get("SystemRoot", ""))
    executable = system_root / "System32" / "schtasks.exe"
    if not system_root.is_absolute() or not executable.is_file():
        raise CredentialError("STARTUP_SERVICE_UNAVAILABLE")
    return executable


def _owned_xml(raw, expected):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= 65536:
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    existing = raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
    old, new = ET.fromstring(re.sub(r"^\s*<\?xml[^?]*\?>", "", existing)), ET.fromstring(expected)
    ns = {"t": NAMESPACE}
    if len(old.findall("t:Principals/t:Principal", ns)) != 1:
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    if _principal_sid(old.findtext("t:Principals/t:Principal/t:UserId", namespaces=ns)) != new.findtext("t:Principals/t:Principal/t:UserId", namespaces=ns):
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    for field in ("t:Principals/t:Principal/t:LogonType", "t:Principals/t:Principal/t:RunLevel",
                  "t:Actions/t:Exec/t:Command", "t:Actions/t:Exec/t:Arguments", "t:Actions/t:Exec/t:WorkingDirectory"):
        previous = old.findtext(field, namespaces=ns)
        if field.endswith(":RunLevel") and previous is None:
            previous = "LeastPrivilege"
        if previous != new.findtext(field, namespaces=ns):
            raise CredentialError("STARTUP_REPAIR_REJECTED")
    if len(old.findall("t:Actions/t:Exec", ns)) != 1 or len(old.findall("t:Actions/*", ns)) != 1:
        raise CredentialError("STARTUP_REPAIR_REJECTED")
    return old


def inspect(configuration, *, require_owned=False):
    """Nonzero query results are UNKNOWN, never guessed to mean not installed."""
    executable, expected = _scheduler(), specification(configuration)
    task_name = "TradeOS-MT5-" + configuration.binding.connection_id
    try:
        result = subprocess.run([str(executable), "/Query", "/TN", task_name, "/XML"], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode != 0:
            raise CredentialError("STARTUP_REPAIR_REJECTED")
        root = _owned_xml(result.stdout, expected)
        enabled = root.findtext("t:Settings/t:Enabled", namespaces={"t": NAMESPACE})
        if enabled not in (None, "true", "false"):
            raise CredentialError("STARTUP_REPAIR_REJECTED")
        return {"taskName": task_name, "state": "ENABLED" if enabled != "false" else "DISABLED", "ownershipVerified": True}
    except (OSError, subprocess.TimeoutExpired, ET.ParseError, UnicodeError, CredentialError):
        if require_owned:
            raise CredentialError("STARTUP_REPAIR_REJECTED") from None
        return {"taskName": task_name, "state": "UNVERIFIED_OR_NOT_INSTALLED", "ownershipVerified": False}


def set_enabled(configuration, enabled):
    if enabled is not False:
        raise CredentialError("INVALID_STARTUP_CONFIGURATION")
    current = inspect(configuration, require_owned=True)
    try:
        result = subprocess.run([str(_scheduler()), "/Change", "/TN", current["taskName"], "/DISABLE"],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=15, check=False, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode != 0:
            raise CredentialError("STARTUP_CHANGE_REQUIRES_INSPECTION")
    except (OSError, subprocess.TimeoutExpired):
        raise CredentialError("STARTUP_CHANGE_REQUIRES_INSPECTION") from None
    after = inspect(configuration, require_owned=True)
    if after["state"] != "DISABLED":
        raise CredentialError("STARTUP_CHANGE_REQUIRES_INSPECTION")
    return after


def install(configuration, *, repair_owned=False) -> dict:
    if os.name != "nt":
        raise CredentialError("WINDOWS_PROTECTION_REQUIRED")
    if not configuration.spool.is_file():
        raise CredentialError("COLLECTOR_NOT_INITIALIZED")
    configuration.terminal.validate()
    xml = specification(configuration)
    task_name = "TradeOS-MT5-" + configuration.binding.connection_id
    system_root = Path(os.environ.get("SystemRoot", ""))
    executable = system_root / "System32" / "schtasks.exe"
    if not system_root.is_absolute() or not executable.is_file():
        raise CredentialError("STARTUP_SERVICE_UNAVAILABLE")
    if repair_owned:
        # A repair is explicit and restricted to our exact account/action/user.
        try:
            current = subprocess.run([str(executable), "/Query", "/TN", task_name, "/XML"],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=15, check=False, creationflags=subprocess.CREATE_NO_WINDOW)
            if current.returncode != 0 or len(current.stdout) > 65536:
                raise CredentialError("STARTUP_REPAIR_REJECTED")
            _owned_xml(current.stdout, xml)
        except (OSError, subprocess.TimeoutExpired, ET.ParseError, UnicodeError):
            raise CredentialError("STARTUP_REPAIR_REQUIRES_INSPECTION") from None
    temporary = None
    try:
        descriptor, name = tempfile.mkstemp(prefix=".startup-", suffix=".xml", dir=configuration.path.parent)
        temporary = Path(name)
        with os.fdopen(descriptor, "wb") as handle:
            restrict_access(temporary)
            handle.write(xml.encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        result = subprocess.run(
            [str(executable), "/Create", "/TN", task_name, "/XML", str(temporary)] + (["/F"] if repair_owned else []),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        # /F is used only by explicit repair after exact action/user inspection.
        if result.returncode != 0:
            raise CredentialError("STARTUP_REGISTRATION_REJECTED")
    except (OSError, subprocess.TimeoutExpired):
        # Registration may have committed even if its acknowledgment was lost.
        # Inspect the exact task; do not automatically delete or replace it.
        raise CredentialError("STARTUP_REGISTRATION_REQUIRES_INSPECTION") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {
        "connectionId": configuration.binding.connection_id,
        "taskName": task_name,
        "installed": True,
        "startsAt": "USER_SIGN_IN",
        "startedNow": False,
        "watchdogSeconds": 60,
        "repairedOwnedTask": repair_owned,
    }

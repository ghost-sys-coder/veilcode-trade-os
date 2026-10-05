"""Current-user, sign-in Task Scheduler registration; never overwrites a task.

No passwords, boot trigger, SYSTEM execution, account switching or shell.
Registration does not start a collector or change its durable PAUSED intent.
"""

import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .windows_security import CredentialError, _current_sid, _windows_dlls, restrict_access

NAMESPACE = "http://schemas.microsoft.com/windows/2004/02/mit/task"
ET.register_namespace("", NAMESPACE)


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


def install(configuration) -> dict:
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
            [str(executable), "/Create", "/TN", task_name, "/XML", str(temporary)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        # Deliberately no /F: existing task names are not silently replaced.
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
    }

import json
import subprocess
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import Mock, patch

import test_cli

from trade_os_mt5.cli import load_configuration, perform
from trade_os_mt5.startup import NAMESPACE, install, specification, task_xml
from trade_os_mt5.windows_security import CredentialError


class StartupTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CliTests()
        self.fixture.setUp()
        self.configuration = load_configuration(self.fixture.path)

    def tearDown(self):
        self.fixture.tearDown()

    def test_task_runs_only_as_current_interactive_user_without_password_or_shell(self):
        xml = specification(self.configuration)
        self.assertFalse(xml.startswith("<?xml"))
        root = ET.fromstring(xml)
        ns = {"t": NAMESPACE}
        self.assertEqual(root.findtext("t:Principals/t:Principal/t:LogonType", namespaces=ns), "InteractiveToken")
        self.assertEqual(root.findtext("t:Principals/t:Principal/t:RunLevel", namespaces=ns), "LeastPrivilege")
        self.assertEqual(root.findtext("t:Settings/t:MultipleInstancesPolicy", namespaces=ns), "IgnoreNew")
        self.assertEqual(root.findtext("t:Settings/t:ExecutionTimeLimit", namespaces=ns), "PT0S")
        self.assertEqual(root.findtext("t:Settings/t:RestartOnFailure/t:Interval", namespaces=ns), "PT1M")
        self.assertIsNone(root.find("t:Triggers/t:BootTrigger", ns))
        self.assertEqual(root.findtext("t:Triggers/t:TimeTrigger/t:Repetition/t:Interval", namespaces=ns), "PT1M")
        self.assertIn("-m trade_os_mt5.cli run --config", root.findtext("t:Actions/t:Exec/t:Arguments", namespaces=ns))
        self.assertEqual(
            root.findtext("t:Triggers/t:LogonTrigger/t:UserId", namespaces=ns),
            root.findtext("t:Principals/t:Principal/t:UserId", namespaces=ns),
        )
        self.assertNotIn("password", ET.tostring(root).decode().lower())
        self.assertTrue(root.findtext("t:Actions/t:Exec/t:Command", namespaces=ns).endswith("pythonw.exe"))

    def test_registration_uses_exact_task_no_overwrite_no_shell_and_cleans_own_xml(self):
        perform("init", self.configuration)
        with patch("trade_os_mt5.startup.subprocess.run", return_value=Mock(returncode=0)) as run:
            result = install(self.configuration)
        args = run.call_args.args[0]
        self.assertEqual(args[1:4], ["/Create", "/TN", "TradeOS-MT5-" + self.configuration.binding.connection_id])
        self.assertNotIn("/F", args)
        self.assertNotIn("shell", run.call_args.kwargs)
        self.assertEqual(run.call_args.kwargs["creationflags"], subprocess.CREATE_NO_WINDOW)
        self.assertFalse(Path(args[-1]).exists())
        self.assertFalse(result["startedNow"])
        self.assertFalse(list(self.configuration.path.parent.glob(".startup-*.xml")))

    def test_failed_and_uncertain_install_are_explicit_without_force_retry(self):
        perform("init", self.configuration)
        for response, expected in (
            (Mock(returncode=1), "STARTUP_REGISTRATION_REJECTED"),
            (subprocess.TimeoutExpired("controlled-fixture", 15), "STARTUP_REGISTRATION_REQUIRES_INSPECTION"),
        ):
            with patch("trade_os_mt5.startup.subprocess.run") as run:
                if isinstance(response, Exception):
                    run.side_effect = response
                else:
                    run.return_value = response
                with self.assertRaisesRegex(CredentialError, expected):
                    install(self.configuration)
            self.assertFalse(list(self.configuration.path.parent.glob(".startup-*.xml")))

    def test_uninitialized_collector_cannot_register_startup(self):
        with patch("trade_os_mt5.startup.subprocess.run") as run:
            with self.assertRaisesRegex(CredentialError, "COLLECTOR_NOT_INITIALIZED"):
                install(self.configuration)
        run.assert_not_called()

    def test_sid_shell_quotes_and_control_characters_cannot_change_task_action(self):
        for sid, executable in (
            ("S-1-5-18", Path("C:/python.exe")),
            ("S-1-5-21-1-2-3-4", Path('C:/bad"path/python.exe')),
        ):
            with self.assertRaises(CredentialError):
                task_xml(
                    self.configuration,
                    user_sid=sid,
                    python_executable=executable,
                    working_directory=Path(__file__).resolve().parent,
                )

    def test_task_spec_cli_returns_no_credentials(self):
        result = perform("startup-spec", self.configuration)
        self.assertNotIn("refreshToken", json.dumps(result))

    def test_repair_requires_exact_existing_action_and_current_user(self):
        perform("init", self.configuration)
        xml = specification(self.configuration).encode()
        with patch("trade_os_mt5.startup.subprocess.run", side_effect=[Mock(returncode=0,stdout=xml),Mock(returncode=0)]) as run:
            result = install(self.configuration, repair_owned=True)
        self.assertTrue(result["repairedOwnedTask"])
        self.assertIn("/F",run.call_args.args[0])
        with patch("trade_os_mt5.startup.subprocess.run", return_value=Mock(returncode=0,stdout=xml.replace(b"InteractiveToken",b"Password"))) as run:
            with self.assertRaisesRegex(CredentialError,"STARTUP_REPAIR_REJECTED"):
                install(self.configuration,repair_owned=True)
        self.assertEqual(run.call_count,1)

    def test_repair_is_explicit_and_unreadable_task_is_not_overwritten(self):
        with self.assertRaisesRegex(CredentialError,"CONTROL_REASON_REQUIRED"):
            perform("repair-startup",self.configuration)
        perform("init",self.configuration)
        with patch("trade_os_mt5.startup.subprocess.run", return_value=Mock(returncode=1,stdout=b"")) as run:
            with self.assertRaisesRegex(CredentialError,"STARTUP_REPAIR_REJECTED"):
                install(self.configuration,repair_owned=True)
        self.assertEqual(run.call_count,1)

    def test_scheduler_utf16_declaration_and_omitted_least_privilege_are_normalized(self):
        perform("init",self.configuration)
        root=ET.fromstring(specification(self.configuration))
        ns={"t":NAMESPACE}
        principal=root.find("t:Principals/t:Principal",ns)
        principal.remove(principal.find("t:RunLevel",ns))
        xml=b'<?xml version="1.0" encoding="UTF-16"?>\r\n'+ET.tostring(root,encoding="utf-8")
        with patch("trade_os_mt5.startup.subprocess.run",side_effect=[Mock(returncode=0,stdout=xml),Mock(returncode=0)]):
            self.assertTrue(install(self.configuration,repair_owned=True)["repairedOwnedTask"])

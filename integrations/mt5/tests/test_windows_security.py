import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from test_outbox import CONNECTION

from trade_os_mt5.windows_security import CredentialError, WindowsCredentialStore, protect


@unittest.skipUnless(os.name == "nt", "Native Windows verification required")
class WindowsSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-dpapi-test-")
        self.root = Path(self.temp.name)
        self.store = WindowsCredentialStore(CONNECTION, _test_directory=self.root / "credentials")
        self.context = "fixture:owner:account:connection:client:resource"
        self.payload = {
            "accessToken": "SYNTHETIC_ACCESS_TOKEN",
            "refreshToken": "SYNTHETIC_REFRESH_TOKEN",
            "generation": 1,
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_native_user_dpapi_roundtrip_and_wrong_scope_rejected(self):
        encrypted = protect(b"SYNTHETIC_SECRET", self.context)
        self.assertNotIn(b"SYNTHETIC_SECRET", encrypted)
        self.assertEqual(protect(encrypted, self.context, decrypt=True), b"SYNTHETIC_SECRET")
        with self.assertRaises(CredentialError):
            protect(encrypted, "other-account", decrypt=True)

    def test_tampered_native_record_never_yields_valid_credentials(self):
        self.store.save(self.payload, self.context)
        data = bytearray(self.store.path.read_bytes())
        data[len(data) // 2] ^= 0xFF
        self.store.path.write_bytes(data)
        with self.assertRaises(CredentialError):
            self.store.load(self.context)

    def test_store_is_encrypted_and_survives_an_actual_python_restart(self):
        self.store.save(self.payload, self.context)
        ciphertext = self.store.path.read_bytes()
        self.assertNotIn(self.payload["accessToken"].encode(), ciphertext)
        self.assertNotIn(self.payload["refreshToken"].encode(), ciphertext)
        code = """import sys
from pathlib import Path
from trade_os_mt5.windows_security import WindowsCredentialStore
store=WindowsCredentialStore(sys.argv[1],_test_directory=Path(sys.argv[2]))
assert store.load(sys.argv[3])['generation']==1
print('verified')"""
        result = subprocess.run(
            [sys.executable, "-c", code, CONNECTION, str(self.store.directory), self.context],
            capture_output=True,
            timeout=10,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), b"verified")

    def test_failed_rotation_preserves_original_record(self):
        self.store.save(self.payload, self.context)
        with patch(
            "trade_os_mt5.windows_security.protect", side_effect=CredentialError("CREDENTIAL_PROTECTION_FAILED")
        ):
            with self.assertRaises(CredentialError):
                self.store.save({**self.payload, "generation": 2}, self.context)
        self.assertEqual(self.store.load(self.context), self.payload)
        self.assertEqual(list(self.store.directory.glob(".rotate-*")), [])

    def test_disk_full_during_encrypted_write_preserves_original_credentials(self):
        self.store.save(self.payload, self.context)
        with patch("trade_os_mt5.windows_security.os.fsync", side_effect=OSError("Synthetic disk-full failure")):
            with self.assertRaises(CredentialError):
                self.store.save({**self.payload, "generation": 2}, self.context)
        self.assertEqual(self.store.load(self.context), self.payload)
        self.assertEqual(list(self.store.directory.glob(".rotate-*")), [])

    def test_invalid_or_oversize_records_fail_without_plaintext_fallback(self):
        with self.assertRaises(CredentialError):
            self.store.save({"secret": "X" * 131073}, self.context)
        self.assertFalse(self.store.path.exists())
        with self.assertRaises(CredentialError):
            protect(b"", self.context)

    def test_cross_process_lock_excludes_duplicate_and_releases_after_death(self):
        code = """import sys,time
from pathlib import Path
from trade_os_mt5.windows_security import SingleInstance
lock=SingleInstance(Path(sys.argv[1]))
print('locked',flush=True)
time.sleep(30)"""
        process = subprocess.Popen(
            [sys.executable, "-c", code, str(self.store.lock_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        try:
            self.assertEqual(process.stdout.readline().strip(), b"locked")
            with self.assertRaises(CredentialError) as error:
                self.store.lock()
            self.assertEqual(error.exception.code, "COLLECTOR_ALREADY_RUNNING")
            process.kill()
            process.wait(5)
            with self.store.lock():
                pass
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)

    def test_permission_descriptor_has_only_user_and_system_not_inherited_everyone(self):
        # Native ACL evidence, not a mock or inference from the home directory.
        self.store.save(self.payload, self.context)
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "$acl=Get-Acl -LiteralPath $env:TRADE_OS_ACL_TEST_FILE; @{Protected=$acl.AreAccessRulesProtected; Rules=@($acl.Access | ForEach-Object { $_.IdentityReference.Value })} | ConvertTo-Json -Compress",
            ],
            env={**os.environ, "TRADE_OS_ACL_TEST_FILE": str(self.store.path)},
            capture_output=True,
            timeout=10,
            check=True,
        )
        acl = json.loads(result.stdout)
        self.assertTrue(acl["Protected"])
        self.assertEqual(len(acl["Rules"]), 2)
        self.assertIn("NT AUTHORITY\\SYSTEM", acl["Rules"])
        self.assertFalse(any("Everyone" in rule or "BUILTIN\\Users" == rule for rule in acl["Rules"]))


if __name__ == "__main__":
    unittest.main()

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

SCRIPT = Path(__file__).resolve().parents[1] / "vault.py"


@unittest.skipUnless(os.name == "nt", "Native Windows required; run the mandatory gate on Windows")
class McpVaultTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="trade-os-mcp-vault-")
        self.root = Path(self.temp.name)
        self.environment = {**os.environ, "LOCALAPPDATA": str(self.root)}
        self.identifier = str(uuid4())
        self.context = "Trade OS MCP credentials v1\nfixture\nhttps://trade.example/mcp\nissuer\nclient"
        self.children = []

    def tearDown(self):
        for child in self.children:
            child.stdin.close()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=3)
            child.stdout.close()
            child.stderr.close()
        self.temp.cleanup()

    def start(self, context=None, coordinated=False):
        child = subprocess.Popen(
            [sys.executable, "-I", "-u", str(SCRIPT)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment, text=True,
        )
        self.children.append(child)
        init = {"id": self.identifier, "context": context or self.context}
        if coordinated:
            init["coordination"] = "transaction"
        return child, self.send(child, init)

    def test_desktop_instances_share_latest_records_not_lifetime_lock(self):
        first, result = self.start(coordinated=True)
        self.assertEqual(result, {"ready": True})
        second, result = self.start(coordinated=True)
        self.assertEqual(result, {"ready": True})
        self.assertEqual(self.send(first, {"action": "acquire"}), {"acquired": True})
        self.assertEqual(self.send(second, {"action": "acquire"}), {"error": "PROFILE_BUSY"})
        self.assertIsNone(second.poll())  # Busy acquisition is safe to retry, not fatal.
        payload = {"accessToken": "PRIVATE_NEXT_ACCESS", "refreshToken": "PRIVATE_NEXT_REFRESH"}
        self.assertEqual(self.send(first, {"action": "save", "payload": payload}), {"saved": True})
        self.assertEqual(self.send(first, {"action": "release"}), {"released": True})
        self.assertEqual(self.send(second, {"action": "acquire"}), {"acquired": True})
        self.assertEqual(self.send(second, {"action": "load"}), {"payload": payload})
        self.assertEqual(self.send(second, {"action": "clear"}), {"cleared": True})
        self.assertEqual(self.send(second, {"action": "release"}), {"released": True})
        self.assertEqual(self.send(first, {"action": "acquire"}), {"acquired": True})
        self.assertEqual(self.send(first, {"action": "load"}), {"payload": {"disconnected": True}})
        self.assertEqual(self.send(first, {"action": "release"}), {"released": True})

    def test_desktop_crash_after_invalidation_never_restores_consumed_secret(self):
        first, _ = self.start(coordinated=True)
        second, _ = self.start(coordinated=True)
        self.send(first, {"action": "acquire"})
        self.send(first, {"action": "save", "payload": {"refreshToken": "PRIVATE_OLD"}})
        self.send(first, {"action": "clear"})
        first.kill()
        first.wait(timeout=3)
        self.assertEqual(self.send(second, {"action": "acquire"}), {"acquired": True})
        self.assertEqual(self.send(second, {"action": "load"}), {"payload": {"disconnected": True}})
        self.assertEqual(self.send(second, {"action": "release"}), {"released": True})

    def test_desktop_clean_exit_releases_held_lock(self):
        first, _ = self.start(coordinated=True)
        second, _ = self.start(coordinated=True)
        self.send(first, {"action": "acquire"})
        first.stdin.close()
        self.assertEqual(first.wait(timeout=3), 0)
        self.assertEqual(self.send(second, {"action": "acquire"}), {"acquired": True})
        self.send(second, {"action": "release"})

    def test_desktop_cannot_load_without_exclusive_ownership(self):
        child, _ = self.start(coordinated=True)
        self.assertEqual(self.send(child, {"action": "load"}), {"error": "VAULT_UNAVAILABLE"})
        child.wait(timeout=3)
        self.assertEqual(child.stderr.read(), "")

    def test_desktop_cannot_release_another_instance_lock(self):
        first, _ = self.start(coordinated=True)
        second, _ = self.start(coordinated=True)
        self.send(first, {"action": "acquire"})
        self.assertEqual(self.send(second, {"action": "release"}), {"error": "VAULT_UNAVAILABLE"})
        second.wait(timeout=3)
        self.assertEqual(self.send(first, {"action": "release"}), {"released": True})

    def test_desktop_does_not_bypass_legacy_client_lock(self):
        first, _ = self.start()
        second, _ = self.start(coordinated=True)
        self.assertEqual(self.send(second, {"action": "acquire"}), {"error": "PROFILE_BUSY"})
        first.stdin.close()
        first.wait(timeout=3)
        self.assertEqual(self.send(second, {"action": "acquire"}), {"acquired": True})
        self.send(second, {"action": "release"})

    def send(self, child, value):
        child.stdin.write(json.dumps(value) + "\n")
        child.stdin.flush()
        return json.loads(child.stdout.readline())

    def test_encrypt_restart_clear_and_no_plaintext_files(self):
        child, result = self.start()
        self.assertEqual(result, {"ready": True})
        self.assertEqual(self.send(child, {"action": "load"}), {"payload": None})
        payload = {"accessToken": "PRIVATE_FIXTURE_ACCESS", "refreshToken": "PRIVATE_FIXTURE_REFRESH"}
        self.assertEqual(self.send(child, {"action": "save", "payload": payload}), {"saved": True})
        path = self.root / "TradeOS" / "credentials" / (self.identifier + ".dpapi")
        self.assertNotIn(b"PRIVATE_FIXTURE", path.read_bytes())
        child.stdin.close()
        child.wait(timeout=3)
        next_child, _ = self.start()
        self.assertEqual(self.send(next_child, {"action": "load"}), {"payload": payload})
        self.assertEqual(self.send(next_child, {"action": "clear"}), {"cleared": True})
        self.assertEqual(self.send(next_child, {"action": "load"}), {"payload": {"disconnected": True}})

    def test_competing_profile_denied_then_os_lock_released_on_process_death(self):
        first, _ = self.start()
        _, result = self.start()
        self.assertEqual(result, {"error": "PROFILE_BUSY"})
        first.kill()
        first.wait(timeout=3)
        _, result = self.start()
        self.assertEqual(result, {"ready": True})

    def test_wrong_context_and_tampering_fail_closed(self):
        child, _ = self.start()
        self.send(child, {"action": "save", "payload": {"secret": "PRIVATE_FIXTURE"}})
        child.stdin.close()
        child.wait(timeout=3)
        wrong, _ = self.start(self.context + "wrong")
        self.assertEqual(self.send(wrong, {"action": "load"}), {"error": "VAULT_UNAVAILABLE"})

    def test_untrusted_actions_are_not_interpreted_as_paths_or_commands(self):
        child, _ = self.start()
        self.assertEqual(self.send(child, {"action": "execute", "command": "PRIVATE_COMMAND"}), {"error": "VAULT_UNAVAILABLE"})
        child.wait(timeout=3)
        self.assertEqual(child.stderr.read(), "")

    def test_duplicate_json_fields_rejected_without_traceback(self):
        child, _ = self.start()
        child.stdin.write('{"action":"load","action":"clear"}\n')
        child.stdin.flush()
        self.assertEqual(json.loads(child.stdout.readline()), {"error": "VAULT_UNAVAILABLE"})
        child.wait(timeout=3)
        self.assertEqual(child.stderr.read(), "")

    def test_oversized_ipc_rejected_without_echoing_payload(self):
        child, _ = self.start()
        child.stdin.write(json.dumps({"action": "save", "payload": {"secret": "X" * 131073}}) + "\n")
        child.stdin.flush()
        self.assertEqual(json.loads(child.stdout.readline()), {"error": "VAULT_UNAVAILABLE"})


if __name__ == "__main__":
    unittest.main()

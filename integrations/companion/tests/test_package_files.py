import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

from trade_os_companion.package_files import archive_name, extract, inventory
from trade_os_companion.setup import SetupError


class ArchiveTests(unittest.TestCase):
    def test_traversal_and_windows_aliases(self):
        for name in ("../user.txt", "/root.txt", "C:/user.txt", "a\\b.txt", "a//b", "a/./b", "a/b.", "a/NUL.txt", "a/file:stream", "a/CON", "a\x00.txt",
                     "a/name?.txt", "a/name*.txt", 'a/name".txt', "a/name<.txt", "a/name>.txt", "a/name|.txt"):
            with self.subTest(name=name), self.assertRaises(SetupError):
                archive_name(name)

    def test_case_aliases_and_symlinks_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for kind in ("duplicate", "symlink"):
                source = root / f"{kind}.zip"
                with zipfile.ZipFile(source, "w") as archive:
                    archive.writestr("valid.txt", "okay")
                    if kind == "duplicate":
                        archive.writestr("VALID.txt", "no")
                    else:
                        link = zipfile.ZipInfo("link")
                        link.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(link, "elsewhere")
                output = root / kind
                with self.assertRaises(SetupError):
                    extract(source, output)
                self.assertFalse(output.exists())

    def test_exact_selected_files_and_checksum_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "runtime.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("runtime/node.exe", "fake-test-only")
                archive.writestr("runtime/LICENSE", "test license")
                archive.writestr("runtime/unselected.txt", "not shipped")
            output = root / "output"
            extract(source, output, prefix="runtime", selected=frozenset({"node.exe", "LICENSE"}))
            files = inventory(output)
            self.assertEqual({row["path"] for row in files}, {"node.exe", "LICENSE"})
            self.assertTrue(all(len(row["sha256"]) == 64 for row in files))
            with self.assertRaises(SetupError):
                extract(source, output)

    def test_missing_selected_runtime_is_not_a_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "runtime.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("runtime/LICENSE", "test")
            output = root / "output"
            with self.assertRaises(SetupError):
                extract(source, output, prefix="runtime", selected=frozenset({"node.exe", "LICENSE"}))
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()

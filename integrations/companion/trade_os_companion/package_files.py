"""Build/install archive boundaries. No traversal, links or unbounded extraction."""

import hashlib
import os
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

from .setup import SetupError, local_path

RESERVED = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$", re.I)


def archive_name(name: str) -> PurePosixPath:
    if (not isinstance(name, str) or not name or len(name) > 240 or any(ord(c) < 32 for c in name)
            or any(c in name for c in ('"', "<", ">", "|", "?", "*"))):
        raise SetupError("UNSAFE_ARCHIVE")
    parts = name.rstrip("/").split("/")
    if (name.startswith("/") or "\\" in name or ":" in name or any(p in ("", ".", "..")
            or p.endswith((".", " ")) or RESERVED.fullmatch(p) for p in parts)):
        raise SetupError("UNSAFE_ARCHIVE")
    return PurePosixPath(*parts)


def extract(archive: Path, destination: Path, *, prefix: str = "", selected: frozenset[str] | None = None):
    destination = local_path(destination)
    if destination.exists():
        raise SetupError("DESTINATION_EXISTS")
    with zipfile.ZipFile(local_path(archive)) as source:
        entries = source.infolist()
        if len(entries) > 30000 or sum(row.file_size for row in entries) > 512 * 1024 * 1024:
            raise SetupError("UNSAFE_ARCHIVE")
        chosen = []
        names = set()
        for row in entries:
            path = archive_name(row.filename)
            if row.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or stat.S_ISLNK(row.external_attr >> 16):
                raise SetupError("UNSAFE_ARCHIVE")
            if row.is_dir():
                continue
            name = str(path)
            if prefix:
                if not name.startswith(prefix + "/"):
                    raise SetupError("UNSAFE_ARCHIVE")
                name = name[len(prefix) + 1:]
            if selected is not None and name not in selected:
                continue
            lowered = name.casefold()
            if lowered in names:
                raise SetupError("UNSAFE_ARCHIVE")
            names.add(lowered)
            chosen.append((row, archive_name(name)))
        if selected is not None and names != {name.casefold() for name in selected}:
            raise SetupError("INCOMPLETE_ARCHIVE")
        # Validate the entire archive before the first disk write.
        destination.mkdir(parents=True)
        for row, relative in chosen:
            target = local_path(destination.joinpath(*relative.parts))
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(row) as incoming, target.open("xb") as outgoing:
                total = 0
                while chunk := incoming.read(65536):
                    total += len(chunk)
                    if total > row.file_size:
                        raise SetupError("UNSAFE_ARCHIVE")
                    outgoing.write(chunk)
                if total != row.file_size:
                    raise SetupError("INCOMPLETE_ARCHIVE")


def inventory(root: Path, *, excluded_folders: frozenset[str] = frozenset()):
    root = local_path(root)
    files = []
    # Validate each directory/entry once, not every ancestor once per file.
    # Do not traverse links or Windows reparse points, even in build artifacts.
    for directory, subdirectories, filenames in os.walk(root, followlinks=False):
        if Path(directory) == root:
            subdirectories[:] = [name for name in subdirectories if name not in excluded_folders]
        for name in (*subdirectories, *filenames):
            path = Path(directory) / name
            status = path.lstat()
            if stat.S_ISLNK(status.st_mode) or getattr(status, "st_file_attributes", 0) & 1024:
                raise SetupError("UNSAFE_LOCAL_PATH")
        for filename in filenames:
            path = Path(directory) / filename
            name = path.relative_to(root).as_posix()
            archive_name(name)
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                while chunk := handle.read(65536):
                    digest.update(chunk)
            files.append({"path": name, "size": path.stat().st_size, "sha256": digest.hexdigest()})
    return sorted(files, key=lambda row: row["path"])

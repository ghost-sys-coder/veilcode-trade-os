"""Offline extraction and inventory entry point for checksum-verified build inputs."""

import argparse
import json
import zipfile
from pathlib import Path

from .package_files import extract, inventory
from .setup import local_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("extract", "inventory", "pack"))
    parser.add_argument("--path", required=True, type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--selected", nargs="*")
    parser.add_argument("--exclude", nargs="*", default=[])
    args = parser.parse_args()
    if args.action == "extract":
        if args.destination is None:
            raise ValueError("Build destination required")
        extract(args.path, args.destination, prefix=args.prefix,
                selected=frozenset(args.selected) if args.selected else None)
    elif args.action == "inventory":
        print(json.dumps(inventory(args.path, excluded_folders=frozenset(args.exclude)), separators=(",", ":")))
    else:
        if args.destination is None:
            raise ValueError("Package destination required")
        # Build manifests may exceed the public setup-file size boundary.
        root = local_path(args.path)
        with (root / "bundle-manifest.json").open("r", encoding="utf8") as handle:
            manifest = json.load(handle)
        destination = local_path(args.destination)
        with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for row in manifest["files"]:
                archive.write(local_path(root / row["path"]), row["path"])
            archive.write(root / "bundle-manifest.json", "bundle-manifest.json")


if __name__ == "__main__":
    main()

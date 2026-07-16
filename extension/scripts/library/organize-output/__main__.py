#!/usr/bin/env python3
"""Organize a folder's loose files into dated ``YYYY.MM/YYYY.MM.DD`` subfolders.

Bundled Saropa Workspace script (self-contained: this entry point plus the
``modules/`` package beside it). Runs against the folder given as the first
argument, or the current working directory when none is given — the extension
defaults the working directory to the open project root, so a bare run organizes
the project's own output folder.

Each file is grouped by a date parsed from its name, falling back to the file's
creation time. Empty folders left behind are pruned. Files being actively written,
hidden/dot paths, and already-organized files are left alone.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Python puts the running file's own directory on sys.path[0], so the bundled
# ``modules`` package imports regardless of the working directory — which is the
# project being organized, not this script's folder.
from modules.organizer import organize_and_prune


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="organize-output",
        description="Sort a folder's loose files into dated YYYY.MM/YYYY.MM.DD subfolders.",
    )
    parser.add_argument(
        "folder",
        nargs="?",
        default=".",
        help="Folder to organize (default: the current directory).",
    )
    parser.add_argument(
        "--no-prune",
        action="store_true",
        help="Keep empty folders instead of removing them after moving.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would move without changing anything on disk.",
    )
    args = parser.parse_args(argv)

    target = Path(args.folder).expanduser().resolve()
    if not target.is_dir():
        print(f"Not a folder: {target}")
        return 2

    moved, skipped, removed = organize_and_prune(
        target,
        prune_empty=not args.no_prune,
        dry_run=args.dry_run,
    )

    verb = "Would move" if args.dry_run else "Moved"
    print(
        f"\nDone. {verb} {moved} file(s), skipped {skipped} file(s), "
        f"removed {removed} empty folder(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

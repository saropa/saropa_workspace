#!/usr/bin/env python3
"""Organize a folder's loose files into dated ``YYYY.MM/YYYY.MM.DD`` subfolders.

Bundled Saropa Workspace script (self-contained: this entry point plus the
``modules/`` package beside it). Runs against the folder given as the required
first argument — a project's logs/ or reports/ folder, not the project root
itself. There is no default and no "blank means current directory" fallback: a
bare invocation with no target is a hard error, and organizer.unsafe_target_reason
additionally refuses a repository root or this script's own install directory,
so a bad config or a stray manual invocation cannot organize the wrong folder.

Each file is grouped by a date parsed from its name, falling back to the file's
creation time. Empty folders left behind are pruned. Files being actively written,
hidden/dot paths, and already-organized files are left alone.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Fail with a clear message on an unsupported interpreter rather than a confusing
# downstream error. The shebang requests python3, but a direct `python <script>`
# launch (or a manifest `command` pointing at an old system python) can bypass it.
# Python 2 cannot parse this file at all — the shebang and the manifest interpreter
# are the mitigation there; this guard covers an old-but-parsing Python 3.
if sys.version_info < (3, 8):
    sys.stderr.write("organize-output requires Python 3.8 or newer.\n")
    raise SystemExit(1)

# Python puts the running file's own directory on sys.path[0], so the bundled
# ``modules`` package imports regardless of the working directory — which is the
# project being organized, not this script's folder.
from modules.organizer import UnsafeTargetError, organize_and_prune  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="organize-output",
        description="Sort a folder's loose files into dated YYYY.MM/YYYY.MM.DD subfolders.",
    )
    parser.add_argument(
        "folder",
        help="Folder to organize — required, e.g. a project's logs/ or reports/ folder.",
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

    # No default and no "blank means cwd/project root" fallback: a silent default
    # is exactly what let a bare invocation (no argument, cwd = wherever the
    # terminal happened to be) organize this script's own install folder in
    # practice. Requiring an explicit, non-blank folder makes that a hard error
    # instead of a silent action against the wrong directory.
    folder = args.folder.strip()
    if not folder:
        print("A folder argument is required (blank is not treated as the current directory).")
        return 2
    target = Path(folder).expanduser().resolve()
    if not target.is_dir():
        print(f"Not a folder: {target}")
        return 2

    try:
        moved, skipped, removed = organize_and_prune(
            target,
            prune_empty=not args.no_prune,
            dry_run=args.dry_run,
        )
    except UnsafeTargetError as error:
        print(f"Refusing to organize: {error}")
        return 2

    verb = "Would move" if args.dry_run else "Moved"
    print(
        f"\nDone. {verb} {moved} file(s), skipped {skipped} file(s), "
        f"removed {removed} empty folder(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

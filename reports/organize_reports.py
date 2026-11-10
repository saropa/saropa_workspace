#!/usr/bin/env python3
"""
CLI entry: organize files under reports/ into month and day folders.

Run:
  python reports/organize_reports.py

Layout: reports/YYYY.MM/YYYY.MM.DD/<file name unchanged>
  2026.11.10_workspace_053430_ci.md   -> 2026.11/2026.11.10/
  2026-09-18_19-15-08_vibrancy.json   -> 2026.09/2026.09.18/
  20260414_231243.log                 -> 2026.04/2026.04.14/
A file with no date in its name (e.g. image.png) takes the date of the folder
it sits in. Files with no date anywhere, and dot-folders such as
.saropa_lints/, are left alone. Empty folders are removed afterwards.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

# Date at the start of a name: 2026.11.10, 2026-11-10 or 20261110.
DATE_AT_START = re.compile(r"^(\d{4})[.-]?(\d{2})[.-]?(\d{2})(?!\d)")


def date_from(name: str) -> tuple[str, str, str] | None:
    m = DATE_AT_START.match(name)
    if not m:
        return None
    year, month, day = m.groups()
    if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
        return None
    return year, month, day


def target_dir_for(file_path: Path, reports_root: Path) -> Path | None:
    date = date_from(file_path.name)
    if date is None and file_path.parent != reports_root:
        date = date_from(file_path.parent.name)
    if date is None:
        return None
    year, month, day = date
    return reports_root / f"{year}.{month}" / f"{year}.{month}.{day}"


def organize_and_prune_reports(reports_root: Path) -> tuple[int, int, int, int]:
    """Returns (moved, already in place, left alone, empty folders removed)."""
    moved = in_place = left_alone = removed = 0

    if not reports_root.exists():
        print(f"Warning: Reports directory '{reports_root}' does not exist.")
        return moved, in_place, left_alone, removed

    for file_path in sorted(reports_root.rglob("*")):
        rel_parts = file_path.relative_to(reports_root).parts
        if any(part.startswith(".") for part in rel_parts):
            continue  # dot-files and dot-folders (.DS_Store, .saropa_lints/)
        if not file_path.is_file() or file_path.name == "organize_reports.py":
            continue

        target_dir = target_dir_for(file_path, reports_root)
        if target_dir is None:
            left_alone += 1
            continue
        if file_path.parent == target_dir:
            in_place += 1
            continue

        target_path = target_dir / file_path.name
        if target_path.exists():
            print(f"Left alone (same name already in target): {file_path.relative_to(reports_root)}")
            left_alone += 1
            continue

        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(file_path), str(target_path))
        moved += 1
        print(f"Moved: {file_path.relative_to(reports_root)} -> {target_path.relative_to(reports_root)}")

    # Remove empty folders, deepest first. A folder holding only .DS_Store counts as empty.
    for dir_path in sorted(reports_root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if not dir_path.is_dir() or dir_path.name.startswith("."):
            continue
        contents = list(dir_path.iterdir())
        if all(p.name == ".DS_Store" for p in contents):
            for p in contents:
                p.unlink()
            dir_path.rmdir()
            removed += 1
            print(f"Removed empty folder: {dir_path.relative_to(reports_root)}")

    return moved, in_place, left_alone, removed


def main() -> int:
    reports_root = Path(__file__).resolve().parent
    moved, in_place, left_alone, removed = organize_and_prune_reports(reports_root)
    print(
        f"\nDone. Moved {moved} file(s). {in_place} already in the right folder. "
        f"{left_alone} left alone. Removed {removed} empty folder(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

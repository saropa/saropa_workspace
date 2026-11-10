#!/usr/bin/env python3
"""
CLI entry: organize files under reports/.

Run:
  python reports/organize_reports.py

Groups files into folders by name prefix:
  2026.11.10_workspace_053430_ci.md -> 2026.11.10_workspace/
  20260414_231243.log               -> 20260414/ (legacy)
Files that match neither pattern stay where they are.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

# "<YYYY.MM.DD>_<project>_<HHMMSS>_<kind>.<ext>"; group 1 is the folder name.
CURRENT_NAME = re.compile(r"^(\d{4}\.\d{2}\.\d{2}_.+?)_\d{6}_")


def organize_and_prune_reports(
    reports_root: Path,
    project_root: Path,
    print_moves: bool = False,
    print_removed: bool = False,
) -> tuple[int, int, int, int]:
    """
    Move report files into their folders and remove empty directories.
    Returns (moved, already in place, not a report name, folders removed).
    """
    moved = 0
    in_place = 0
    unmatched = 0
    removed = 0

    if not reports_root.exists():
        print(f"Warning: Reports directory '{reports_root}' does not exist.")
        return moved, in_place, unmatched, removed

    # ---------------------------------------------------------
    # 1. ORGANIZE FILES
    # Group files like "20260414_231243.log" into "20260414/"
    # ---------------------------------------------------------
    for file_path in reports_root.rglob("*"):
        # Ignore directories and this python script itself
        if not file_path.is_file() or file_path.name == "organize_reports.py":
            continue
            
        # Current names: "2026.11.10_workspace_053430_ci.md" -> "2026.11.10_workspace/"
        # Legacy names: "20260414_231243.log" -> "20260414/"
        match = CURRENT_NAME.match(file_path.name)
        date_prefix = match.group(1) if match else file_path.name[:8]

        if match or (date_prefix.isdigit() and len(date_prefix) == 8):
            target_dir = reports_root / date_prefix
            
            if file_path.parent == target_dir:
                in_place += 1
                continue
                
            # Create the date folder if it doesn't exist
            target_dir.mkdir(exist_ok=True)
            target_path = target_dir / file_path.name
            
            # Move the file
            shutil.move(str(file_path), str(target_path))
            moved += 1
            if print_moves:
                print(f"Moved: {file_path.name} -> {date_prefix}/")
        else:
            # Not a report name (e.g. image.png): leave it where it is
            unmatched += 1

    # ---------------------------------------------------------
    # 2. PRUNE EMPTY FOLDERS
    # Iterate bottom-up (reverse order) to clean up nested empties.
    # ---------------------------------------------------------
    for dir_path in sorted(reports_root.rglob("*"), reverse=True):
        if dir_path.is_dir():
            # Check if directory is empty
            if not any(dir_path.iterdir()):
                dir_path.rmdir()
                removed += 1
                if print_removed:
                    print(f"Removed empty folder: {dir_path.relative_to(project_root)}")

    return moved, in_place, unmatched, removed


def main() -> int:
    reports_root = Path(__file__).resolve().parent
    repo_root = reports_root.parent
    
    moved, in_place, unmatched, removed = organize_and_prune_reports(
        reports_root=reports_root,
        project_root=repo_root,
        print_moves=True,      # Set to True so you can see it working!
        print_removed=True,
    )
    
    print(
        f"\nDone. Moved {moved} file(s). {in_place} already in the right folder. "
        f"{unmatched} left alone (not a report name). "
        f"Removed {removed} empty folder(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
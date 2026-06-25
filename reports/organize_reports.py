#!/usr/bin/env python3
"""
CLI entry: organize files under reports/.

Run:
  python reports/organize_reports.py

Note: This script has been internalized to run standalone without 
relying on an external shared module. It groups files by their 
YYYYMMDD prefix into corresponding folders.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path


def organize_and_prune_reports(
    reports_root: Path,
    project_root: Path,
    print_moves: bool = False,
    print_removed: bool = False,
) -> tuple[int, int, int]:
    """
    Core logic to organize files by YYYYMMDD prefix and remove empty directories.
    """
    moved = 0
    skipped = 0
    removed = 0

    if not reports_root.exists():
        print(f"Warning: Reports directory '{reports_root}' does not exist.")
        return moved, skipped, removed

    # ---------------------------------------------------------
    # 1. ORGANIZE FILES
    # Group files like "20260414_231243.log" into "20260414/"
    # ---------------------------------------------------------
    for file_path in reports_root.rglob("*"):
        # Ignore directories and this python script itself
        if not file_path.is_file() or file_path.name == "organize_reports.py":
            continue
            
        # Extract the first 8 characters to see if it's a date (YYYYMMDD)
        date_prefix = file_path.name[:8]
        
        if date_prefix.isdigit() and len(date_prefix) == 8:
            target_dir = reports_root / date_prefix
            
            # If the file is already in the correct folder, skip it
            if file_path.parent == target_dir:
                skipped += 1
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
            # Skip files that don't match the date pattern
            skipped += 1

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

    return moved, skipped, removed


def main() -> int:
    reports_root = Path(__file__).resolve().parent
    repo_root = reports_root.parent
    
    moved, skipped, removed = organize_and_prune_reports(
        reports_root=reports_root,
        project_root=repo_root,
        print_moves=True,      # Set to True so you can see it working!
        print_removed=True,
    )
    
    print(
        f"\nDone. Moved {moved} file(s), skipped {skipped} file(s), "
        f"removed {removed} empty folder(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
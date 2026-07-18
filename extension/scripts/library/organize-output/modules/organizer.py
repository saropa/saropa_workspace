#!/usr/bin/env python3
"""Move a folder's loose files into dated ``YYYY.MM/YYYY.MM.DD`` subfolders.

The core of the organize-output script. Given a target folder, every loose file
is placed under ``<target>/YYYY.MM/YYYY.MM.DD/<name>`` using a date parsed from
the filename, or the file's creation time when the name carries none. Empty
folders left behind are pruned deepest-first.

Generalized from a project-internal reports organizer: it takes the target folder
as a parameter (no hardcoded ``reports/`` location), and it has no launcher-file or
legacy-folder special cases — so it works on any folder the user points it at.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

from modules.dates import parse_date_from_name

# A file modified within this window is treated as still being written by another
# process and is left for a later run. Moving a file mid-write yanks it out from
# under its writer (a real FileNotFoundError seen in the source tool). Ten seconds
# comfortably exceeds the gap between successive appends without stranding
# finished files — they organize on the next pass.
_ACTIVE_QUIET_SECONDS = 10.0

# Progress-bar width in characters.
_BAR_WIDTH = 28


def _supports_color() -> bool:
    """ANSI color only when writing to an interactive terminal and NO_COLOR unset."""
    return sys.stdout.isatty() and not bool(os.environ.get("NO_COLOR"))


def _print_progress(
    processed: int,
    total: int,
    moved: int,
    skipped: int,
    *,
    use_color: bool,
) -> None:
    if total <= 0:
        return
    filled = int((processed / total) * _BAR_WIDTH)
    bar = "#" * filled + "-" * (_BAR_WIDTH - filled)
    percent = (processed / total) * 100
    if use_color:
        line = (
            f"\r\033[96m[{bar}] {percent:6.2f}%\033[0m "
            f"\033[92mmoved={moved}\033[0m \033[93mskipped={skipped}\033[0m"
        )
    else:
        line = f"\r[{bar}] {percent:6.2f}% moved={moved} skipped={skipped}"
    print(line, end="", flush=True)
    if processed == total:
        print()


def _iter_files(target: Path) -> list[Path]:
    """Every file under ``target``, resolved, captured once up front."""
    return [p.resolve() for p in target.rglob("*") if p.is_file()]


# This script's own install directory (parent of modules/). Checked so a bare,
# argument-less invocation from inside this folder — e.g. a developer running
# `python __main__.py` by hand from the extension's installed copy — organizes
# its own source files instead of erroring. Happened in practice: cwd defaulted
# to the script's folder and it moved __main__.py/modules/*.py into a dated
# subfolder, breaking that installed copy until the files were moved back.
_SCRIPT_DIR = Path(__file__).resolve().parent.parent


class UnsafeTargetError(ValueError):
    """Raised by organize_and_prune() when the target fails unsafe_target_reason()."""


def unsafe_target_reason(target: Path) -> str | None:
    """Why ``target`` must be refused, or ``None`` when it is safe to organize.

    Enforced regardless of caller (see organize_and_prune), so a bad manifest
    config or a bare manual invocation is caught the same way. A log/report
    folder this tool is meant for is a SUBFOLDER of a project, not the project
    root itself — ``.git`` lives only at the root of the checkout it belongs to,
    so the second check does not fire on a legitimate nested ``reports/`` or
    ``logs/`` target no matter how deep it sits under that root; only ``target``
    itself carrying ``.git`` trips it.
    """
    target = target.resolve()
    script_dir = _SCRIPT_DIR.resolve()
    # Path.is_relative_to() needs 3.9+; this script supports 3.8+, so walk
    # parents by hand to catch target == script_dir, target as an ancestor of
    # script_dir, or target as a descendant of it (e.g. its own modules/ folder).
    if target == script_dir or target in script_dir.parents or script_dir in target.parents:
        return f"target is this script's own install directory ({script_dir})"
    # A normal clone has .git as a directory; a git worktree or submodule has it
    # as a FILE holding a `gitdir: <path>` pointer instead. exists() catches both
    # forms, whereas the original is_dir()-only check missed worktrees/submodules.
    if (target / ".git").exists():
        return f"target is a repository root ({target}) — point at a log/report subfolder instead"
    return None


def _should_skip(file_path: Path, target: Path) -> bool:
    """Skip anything under a dot-folder / dot-file (hidden, tool-owned, VCS)."""
    relative = file_path.relative_to(target)
    return any(part.startswith(".") for part in relative.parts)


def _is_already_organized(file_path: Path, target: Path) -> bool:
    """True when the file already sits under ``target/YYYY.MM/YYYY.MM.DD/``.

    Skip-only (not re-move) so an already-tidy folder produces no churn.
    """
    try:
        relative = file_path.relative_to(target)
    except ValueError:
        return False
    if len(relative.parts) < 3:
        return False
    month, day = relative.parts[0], relative.parts[1]
    return bool(re.fullmatch(r"\d{4}\.\d{2}", month)) and bool(
        re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", day)
    )


def _is_actively_written(file_path: Path, quiet_seconds: float) -> bool:
    """True when the file changed within the quiet window (likely still open).

    A stat failure means the file already vanished — return False and let the
    move's own vanished-source guard own that narrower race.
    """
    try:
        mtime = file_path.stat().st_mtime
    except OSError:
        return False
    return (time.time() - mtime) < quiet_seconds


def _target_path(target: Path, file_path: Path) -> Path:
    """Destination for one file: filename date wins, else the file's creation time."""
    parsed = parse_date_from_name(file_path.name)
    # st_ctime is birth time on Windows and change time on POSIX; it is the closest
    # portable stand-in for "when this file appeared" without a name-borne date.
    effective = parsed or datetime.fromtimestamp(file_path.stat().st_ctime)
    return target / effective.strftime("%Y.%m") / effective.strftime("%Y.%m.%d") / file_path.name


def _unique_destination(destination: Path) -> Path:
    """A non-colliding path: append ``_1``, ``_2`` … when the name is taken."""
    if not destination.exists():
        return destination
    stem, suffix = destination.stem, destination.suffix
    counter = 1
    while True:
        candidate = destination.with_name(f"{stem}_{counter}{suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def _write_activity_log(target: Path, lines: list[str], summary: str) -> None:
    """Append a dated run log under today's folder, so a run is auditable."""
    now = datetime.now()
    day_folder = target / now.strftime("%Y.%m") / now.strftime("%Y.%m.%d")
    day_folder.mkdir(parents=True, exist_ok=True)
    log_path = day_folder / f"{now.strftime('%Y%m%d_%H%M%S')}_organize.log"
    log_path.write_text(
        "\n".join(
            [
                f"Run started: {now.isoformat(timespec='seconds')}",
                f"Target: {target}",
                *lines,
                summary,
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def organize(
    target: Path,
    *,
    dry_run: bool = False,
    print_moves: bool = True,
    active_quiet_seconds: float = _ACTIVE_QUIET_SECONDS,
) -> tuple[int, int]:
    """Move loose files under ``target`` into month/day folders.

    Returns ``(moved, skipped)``. ``dry_run`` reports intended moves and touches
    nothing on disk (no moves, no log).
    """
    target = target.resolve()
    moved = skipped = 0
    activity: list[str] = []

    files = _iter_files(target)
    total = len(files)
    use_color = _supports_color()
    if total:
        _print_progress(0, total, moved, skipped, use_color=use_color)

    for index, file_path in enumerate(files, start=1):
        reason: str | None = None
        if _should_skip(file_path, target):
            reason = "hidden/tool-owned"
        elif _is_already_organized(file_path, target):
            reason = "already organized"
        elif _is_actively_written(file_path, active_quiet_seconds):
            # Checked just before the move (not at scan time, which only listed
            # names), so the mtime reflects the file's most recent write.
            reason = "active/being written"

        if reason is not None:
            skipped += 1
            activity.append(f"Skipped ({reason}): {file_path}")
            _print_progress(index, total, moved, skipped, use_color=use_color)
            continue

        destination = _unique_destination(_target_path(target, file_path))
        if file_path == destination.resolve():
            skipped += 1
            activity.append(f"Skipped (already at destination): {file_path}")
            _print_progress(index, total, moved, skipped, use_color=use_color)
            continue

        if dry_run:
            moved += 1
            activity.append(f"Would move: {file_path} -> {destination}")
            if print_moves:
                print(f"Would move: {file_path} -> {destination}")
            _print_progress(index, total, moved, skipped, use_color=use_color)
            continue

        # Guard the check-to-move window: _unique_destination picked a free name,
        # but a concurrent process could create it before this move runs. On POSIX
        # shutil.move OVERWRITES an existing destination file (silently, raising
        # nothing the handler below would catch), so re-verify the name is still
        # free and skip rather than clobber if it was taken in that gap.
        if destination.exists():
            skipped += 1
            activity.append(f"Skipped (destination appeared): {file_path}")
            _print_progress(index, total, moved, skipped, use_color=use_color)
            continue

        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(file_path), str(destination))
        except (PermissionError, FileNotFoundError) as error:
            # PermissionError: the file is locked by another process (still being
            # written). FileNotFoundError: a benign TOCTOU race — the file list is
            # captured once up front and a running process can rotate/delete a file
            # before its move. Neither is fatal; skip and carry on.
            skipped += 1
            activity.append(f"Skipped ({type(error).__name__}): {file_path}")
            _print_progress(index, total, moved, skipped, use_color=use_color)
            continue

        moved += 1
        activity.append(f"Moved: {file_path} -> {destination}")
        if print_moves:
            print(f"Moved: {file_path} -> {destination}")
        _print_progress(index, total, moved, skipped, use_color=use_color)

    # Only write the audit log when something actually moved. A run against an
    # already-tidy folder moves nothing; writing a log there would create a fresh
    # dated folder + file on every run, churning a folder we otherwise leave alone.
    if not dry_run and moved > 0:
        _write_activity_log(
            target,
            activity,
            f"Done. Moved {moved} file(s), skipped {skipped} file(s).",
        )
    return moved, skipped


def prune_empty_dirs(target: Path) -> int:
    """Remove empty directories under ``target``, deepest paths first.

    Deepest-first so a parent becomes removable once its emptied children are
    gone. The target root itself is never removed.
    """
    target = target.resolve()
    dirs = sorted(
        (p for p in target.rglob("*") if p.is_dir()),
        key=lambda p: len(p.parts),
        reverse=True,
    )
    removed = 0
    for folder in dirs:
        try:
            if not any(folder.iterdir()):
                folder.rmdir()
                removed += 1
        except OSError:
            # A folder that vanished or is locked between the listing and the
            # remove is not fatal — skip it.
            continue
    return removed


def organize_and_prune(
    target: Path,
    *,
    prune_empty: bool = True,
    dry_run: bool = False,
    print_moves: bool = True,
    force: bool = False,
) -> tuple[int, int, int]:
    """Organize files then optionally prune empty folders. Returns moved, skipped, removed.

    Raises ``UnsafeTargetError`` instead of touching disk when ``target`` fails
    ``unsafe_target_reason`` — enforced here (not only in the CLI) so any caller,
    including a future script that imports this module directly, gets the guard.
    ``force=True`` skips the check entirely; the caller is responsible for
    having already surfaced the reason to the operator (see __main__.py's
    ``--force``, which prints a WARNING naming it before calling this with
    ``force=True``) — this function has no terminal to warn on by itself.
    """
    if not force:
        reason = unsafe_target_reason(target)
        if reason is not None:
            raise UnsafeTargetError(reason)
    moved, skipped = organize(target, dry_run=dry_run, print_moves=print_moves)
    # A dry run reports intended moves but performs none, so nothing has emptied —
    # pruning would delete folders the real run would have kept populated. Skip it.
    removed = prune_empty_dirs(target) if prune_empty and not dry_run else 0
    return moved, skipped, removed

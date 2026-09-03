#!/usr/bin/env python3
"""
Git operations and the GitHub release.

Reports the pre-release working-tree state, commits the version sync, tags and
pushes so the tag points at the release commit, and creates a GitHub release
with the .vsix attached and the changelog section as notes.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import subprocess
import time
from datetime import datetime, timezone

from modules._build import newest_vsix
from modules._utils import (
    GITHUB_REPO,
    REPO_ROOT,
    ROOT_CHANGELOG,
    detail,
    fail,
    header,
    info,
    run,
    success,
    warn,
)
from modules._version_changelog import extract_changelog_section

# Upper bound for --rebase-debounce; a much larger value would stall the
# publish for no added benefit (VS Code's watcher settles well under this).
MAX_REBASE_DEBOUNCE_SECONDS = 10

# Default debounce (also the CLI flag's default in publish.py) — a heuristic,
# not a measurement: VS Code batches native filesystem events over roughly a
# second before its own watcher fires, so 3s gives comfortable headroom on a
# slow disk or a large working tree without the fixed default reader in mind
# needing to be re-tuned per machine.
DEFAULT_REBASE_DEBOUNCE_SECONDS = 3

# Coordination marker written for the duration of the stash/rebase/pop window.
# A future VS Code-side watcher could check for this file's presence and
# suppress/coalesce the refresh it would otherwise fire on the intermediate
# rebase states — this script only produces the signal; nothing consumes it
# yet. Named with the same ".saropa-" prefix as other repo-local scratch state
# and left out of git via .gitignore.
SYNC_MARKER_FILE = REPO_ROOT / ".saropa-sync.json"


def _write_sync_marker(stage: str) -> None:
    """Write/update the coordination marker naming the current sync stage.

    Best-effort: a failure to write it (read-only mount, permissions) must
    never fail the actual git operation it is only signaling about.
    """
    try:
        SYNC_MARKER_FILE.write_text(
            json.dumps({"stage": stage, "updatedAt": datetime.now(timezone.utc).isoformat()}),
            encoding="utf-8",
        )
    except OSError:
        pass


def _clear_sync_marker() -> None:
    SYNC_MARKER_FILE.unlink(missing_ok=True)


def sync_with_remote(rebase_debounce_seconds: int) -> int:
    """Rebase the working branch onto origin/main if it has diverged.

    Stashing, rebasing, then popping makes VS Code's file watcher replay every
    intermediate commit in quick succession — on this repo that includes the
    archive commit that moves closed bugs from bugs/ to plans/history/, which
    briefly reads as "7 new" files in the Explorer/SCM panel before settling
    back. Sleeping between the rebase and the stash pop gives the watcher time
    to catch up on the rebased tree before the pop reintroduces the working
    changes, so the transient churn resolves before it is visible.
    """
    header("GIT SYNC")
    fetch_result = run(["git", "fetch", "origin"], REPO_ROOT, check=False)
    if fetch_result.returncode != 0:
        # A stale fetch means the divergence check below is comparing against
        # an outdated origin/main and could silently skip a rebase that is
        # actually needed — surface it instead of proceeding on stale data.
        warn("git fetch origin failed; divergence check may be comparing against a stale origin/main.")

    counts = run(
        ["git", "rev-list", "--left-right", "--count", "HEAD...origin/main"],
        REPO_ROOT,
        capture=True,
        check=False,
    )
    if counts.returncode != 0 or not counts.stdout.strip():
        # No origin/main to compare against (e.g. detached HEAD, no remote
        # tracking branch, or the fetch above never created it) — nothing to
        # sync, let the rest of the pipeline run.
        detail("  No origin/main tracking ref to compare against; skipping sync.")
        return 0
    ahead_str, behind_str = counts.stdout.split()
    behind = int(behind_str)
    if behind == 0:
        detail("  Already up to date with origin/main.")
        return 0

    status = run(["git", "status", "--porcelain"], REPO_ROOT, capture=True, check=False)
    stashed = bool(status.stdout.strip())

    try:
        if stashed:
            _write_sync_marker("stash")
            run(["git", "stash", "-u"], REPO_ROOT)
        _write_sync_marker("rebase")
        run(["git", "rebase", "origin/main"], REPO_ROOT)
    except subprocess.CalledProcessError:
        # Leave the stash in place on rebase failure — popping onto a broken
        # rebase would compound the conflict instead of surfacing one problem.
        # Clear the marker regardless: a real conflict needs to be visible to
        # any watcher-side consumer, not signaled as "still syncing".
        _clear_sync_marker()
        return fail(
            "git rebase origin/main failed; resolve the conflict, then run "
            "'git rebase --continue' (or 'git rebase --abort' to give up and "
            "restore with 'git stash pop').",
            7,
        )

    if not stashed:
        # Nothing was stashed, so there is no restore window to signal — the
        # marker written for the rebase step above is done once it lands.
        _clear_sync_marker()
        success(f"Rebased onto origin/main ({behind} commit(s)).")
        return 0

    debounce = max(0, min(rebase_debounce_seconds, MAX_REBASE_DEBOUNCE_SECONDS))
    if debounce:
        _write_sync_marker("settling")
        detail(f"  Waiting {debounce}s for the file watcher to settle before restoring changes...")
        time.sleep(debounce)
    try:
        _write_sync_marker("restore")
        run(["git", "stash", "pop"], REPO_ROOT)
    except subprocess.CalledProcessError:
        return fail(
            "git stash pop failed after rebase; resolve the conflict manually, "
            "then run 'git stash drop' once the working tree looks right "
            "(the stash stays queued until you do).",
            7,
        )
    finally:
        _clear_sync_marker()

    success(f"Rebased onto origin/main ({behind} commit(s)).")
    return 0


def check_working_tree() -> None:
    """Report the working-tree state before the release commit.

    Run after version sync, so the version/changelog edits are expected to be
    committed into the release. This surfaces what will be committed rather than
    blocking — a full publish builds its own release commit.
    """
    result = run(["git", "status", "--porcelain"], REPO_ROOT, capture=True, check=False)
    if result.stdout.strip():
        info("Working tree changes that will go into the release commit:")
        for line in result.stdout.splitlines()[:20]:
            detail(f"      {line}")


def git_commit_release(version: str) -> int:
    """Commit the version sync, then tag and push so the tag points at it."""
    header(f"GIT  (release v{version})")
    try:
        run(["git", "add", "-A"], REPO_ROOT)
        # Only commit when there is something staged; a re-run after a clean
        # commit should not fail on "nothing to commit".
        status = run(["git", "status", "--porcelain"], REPO_ROOT, capture=True, check=False)
        if status.stdout.strip():
            run(["git", "commit", "-m", f"chore: release v{version}"], REPO_ROOT)
        run(["git", "tag", "-a", f"v{version}", "-m", f"Release v{version}"], REPO_ROOT)
        run(["git", "push", "origin", "HEAD"], REPO_ROOT)
        run(["git", "push", "origin", f"v{version}"], REPO_ROOT)
    except subprocess.CalledProcessError:
        return fail("git commit/tag/push failed.", 7)
    return 0


def github_release(version: str) -> int:
    """Create a GitHub release with the .vsix attached and changelog notes."""
    header("GITHUB RELEASE")
    vsix = newest_vsix()
    notes = extract_changelog_section(ROOT_CHANGELOG, version) or f"Release v{version}"
    notes_file = REPO_ROOT / f".release-notes-{version}.md"
    notes_file.write_text(notes, encoding="utf-8")
    try:
        args = [
            "gh", "release", "create", f"v{version}",
            "--repo", GITHUB_REPO,
            "--title", f"v{version}",
            "--notes-file", str(notes_file),
        ]
        if vsix is not None:
            args.append(str(vsix))
        run(args, REPO_ROOT)
        success(f"Created GitHub release v{version}.")
    except subprocess.CalledProcessError:
        return fail("gh release create failed.", 8)
    finally:
        notes_file.unlink(missing_ok=True)
    return 0

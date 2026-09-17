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
import re
import subprocess
import sys
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
    is_headless,
    run,
    success,
    warn,
)
from modules._version_changelog import extract_changelog_section, strip_unreleased_marker

# Matches the commit subject this script itself produces in git_commit_release(),
# so a rebase conflict on that exact shape can be diagnosed instead of just
# reported as a generic conflict.
_RELEASE_COMMIT_RE = re.compile(r"^chore: release v(\d+\.\d+\.\d+(?:-[\w.]+)?)$")
_PACKAGE_VERSION_RE = re.compile(r'"version"\s*:\s*"(\d+\.\d+\.\d+(?:-[\w.]+)?)"')

# Cap on consecutive auto-skips in one rebase, so a pathological queue of
# stale commits can't loop indefinitely instead of surfacing to the operator.
_MAX_AUTO_SKIP_ATTEMPTS = 5


def _semver_key(version: str) -> tuple:
    """Best-effort sort key: numeric release tuple, pre-release sorts before release."""
    core, _, pre = version.partition("-")
    return (tuple(int(p) for p in core.split(".")), 0 if pre else 1, pre)


def _diagnose_rebase_conflict() -> tuple[str, bool]:
    """Inspect a failed rebase and return (message, safe_to_auto_skip).

    The one conflict shape this script can predict is its own: a queued local
    "chore: release vX.Y.Z" commit whose CHANGELOG.md/package.json edits are
    already superseded by a newer release that landed on origin/main first.
    safe_to_auto_skip is True only for that exact, provable shape — the commit
    touches nothing but CHANGELOG.md/package.json, matches this script's own
    release-commit subject, and its version is already <= what HEAD carries.
    Anything else is reported but left for the operator to resolve by hand.
    """
    conflicted = run(
        ["git", "diff", "--name-only", "--diff-filter=U"], REPO_ROOT, capture=True, check=False
    )
    files = {line.strip() for line in conflicted.stdout.splitlines() if line.strip()}
    # Only diagnose when the conflict is confined to exactly the files this
    # script's own release commit touches — any other file means a conflict
    # this script had no part in, so bail out to the generic message.
    if not files or not files <= {"CHANGELOG.md", "extension/package.json"}:
        return f"Conflicting file(s): {', '.join(sorted(files)) or 'unknown'}.", False

    subject = run(
        ["git", "log", "-1", "--format=%s", "REBASE_HEAD"], REPO_ROOT, capture=True, check=False
    )
    match = _RELEASE_COMMIT_RE.match(subject.stdout.strip())
    if not match:
        return (
            f"Conflicting file(s): {', '.join(sorted(files))} (commit: {subject.stdout.strip() or 'unknown'}).",
            False,
        )
    stuck_version = match.group(1)

    ours_package = run(
        ["git", "show", "HEAD:extension/package.json"], REPO_ROOT, capture=True, check=False
    )
    ours_match = _PACKAGE_VERSION_RE.search(ours_package.stdout)
    if ours_match and _semver_key(ours_match.group(1)) >= _semver_key(stuck_version):
        return (
            f"Stale local release commit (v{stuck_version}) already superseded by "
            f"origin/main (v{ours_match.group(1)}) — its changes are already included upstream.",
            True,
        )
    return (
        f"Local release commit v{stuck_version} conflicts with CHANGELOG.md/"
        "extension/package.json on origin/main — resolve by hand.",
        False,
    )


def _confirm_skip_stale_commit(message: str) -> bool:
    """Ask whether to skip a rebase commit _diagnose_rebase_conflict() proved stale.

    Headless runs have no one to ask; the caller only reaches here when the
    diagnosis already proved the commit's content is redundant, so headless
    auto-confirms rather than failing a sync that does not actually need a
    human decision. An interactive run still confirms before discarding a commit.
    """
    if is_headless():
        return True
    if not sys.stdin or not sys.stdin.isatty():
        return False
    try:
        choice = input(f"  {message}\n  Skip this commit and continue the rebase? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    return choice in ("y", "yes")


def _rebase_in_progress() -> bool:
    """True if main is already mid-rebase (e.g. left stuck by a prior run)."""
    git_dir = REPO_ROOT / ".git"
    return (git_dir / "rebase-merge").exists() or (git_dir / "rebase-apply").exists()


def _rebase_onto_origin_main() -> None:
    """Run (or resume) `git rebase origin/main`, auto-skipping stale release commits.

    If a rebase is already in progress — left mid-flight by an earlier run
    that hit an unresolved conflict — resume it via `git rebase --skip`
    instead of starting a fresh `git rebase origin/main`, which would just
    fail immediately with "already a rebase-merge directory". Each conflict is
    diagnosed; only a commit _diagnose_rebase_conflict() can prove is already
    superseded upstream is offered for skip, and only after the operator
    confirms (or, headless, because the diagnosis already made it safe).
    Anything else raises CalledProcessError for the normal failure path.
    """
    if _rebase_in_progress():
        info("A rebase is already in progress; resuming it.")
        command = ["git", "rebase", "--skip"]
        # Sentinel: a nonzero "result" so the loop below diagnoses the conflict
        # already sitting there instead of assuming the resumed rebase succeeded.
        result = subprocess.CompletedProcess(command, 1)
    else:
        command = ["git", "rebase", "origin/main"]
        result = run(command, REPO_ROOT, check=False)
        if result.returncode == 0:
            return

    for _ in range(_MAX_AUTO_SKIP_ATTEMPTS):
        message, safe_to_skip = _diagnose_rebase_conflict()
        if not safe_to_skip or not _confirm_skip_stale_commit(message):
            raise subprocess.CalledProcessError(result.returncode, command)
        info(message)
        info("Skipping the redundant commit and continuing the rebase.")
        command = ["git", "rebase", "--skip"]
        result = run(command, REPO_ROOT, check=False)
        if result.returncode == 0:
            return
    raise subprocess.CalledProcessError(result.returncode, command)


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


def resolve_stuck_rebase(rebase_debounce_seconds: int) -> int:
    """Resume a rebase left mid-flight by an earlier, interrupted run, if any.

    A stuck rebase leaves conflict markers sitting in whatever files it
    touched — for this script, that's CHANGELOG.md/package.json, which breaks
    every mode, not just the ones that call sync_with_remote(). So this must
    run unconditionally, before anything reads package.json, rather than only
    as part of the "full" mode's git sync step. It is a no-op when nothing is
    stuck (the common case), so callers can call it unconditionally too.
    """
    if not _rebase_in_progress():
        return 0
    header("GIT SYNC")
    # The working tree's unmerged files are the conflict itself, not stashable
    # work, so there is no stash step here; any stash left by the interrupted
    # run is restored below, same as the fresh-rebase path in sync_with_remote.
    try:
        _write_sync_marker("rebase")
        _rebase_onto_origin_main()
    except subprocess.CalledProcessError:
        _clear_sync_marker()
        diagnosis, _ = _diagnose_rebase_conflict()
        return fail(
            f"git rebase origin/main failed. {diagnosis} Then run "
            "'git rebase --continue' (or 'git rebase --abort' to give up and "
            "restore with 'git stash pop').",
            7,
        )
    success("Resumed and completed the interrupted rebase onto origin/main.")
    return _restore_stash_if_any(rebase_debounce_seconds)


def sync_with_remote(rebase_debounce_seconds: int) -> int:
    """Rebase the working branch onto origin/main if it has diverged.

    Stashing, rebasing, then popping makes VS Code's file watcher replay every
    intermediate commit in quick succession — on this repo that includes the
    archive commit that moves closed bugs from bugs/ to plans/history/, which
    briefly reads as "7 new" files in the Explorer/SCM panel before settling
    back. Sleeping between the rebase and the stash pop gives the watcher time
    to catch up on the rebased tree before the pop reintroduces the working
    changes, so the transient churn resolves before it is visible.

    A rebase already stuck from an earlier run is handled by
    resolve_stuck_rebase() before this ever runs (see publish.py's main()), so
    by the time this is reached, "in progress" is no longer a case to handle
    here — only a fresh divergence against origin/main is left to check.
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
        _rebase_onto_origin_main()
    except subprocess.CalledProcessError:
        # Leave the stash in place on rebase failure — popping onto a broken
        # rebase would compound the conflict instead of surfacing one problem.
        # Clear the marker regardless: a real conflict needs to be visible to
        # any watcher-side consumer, not signaled as "still syncing".
        _clear_sync_marker()
        diagnosis, _ = _diagnose_rebase_conflict()
        return fail(
            f"git rebase origin/main failed. {diagnosis} Then run "
            "'git rebase --continue' (or 'git rebase --abort' to give up and "
            "restore with 'git stash pop').",
            7,
        )

    success(f"Rebased onto origin/main ({behind} commit(s)).")
    return _restore_stash_if_any(rebase_debounce_seconds)


def _restore_stash_if_any(rebase_debounce_seconds: int) -> int:
    """Pop the sync stash if one is queued, after letting the watcher settle.

    Shared by the fresh-rebase and resumed-rebase paths — a resumed rebase may
    have a stash left over from the run that got interrupted, and `git stash
    list` is the only reliable record of whether one is actually pending.
    """
    stash_list = run(["git", "stash", "list"], REPO_ROOT, capture=True, check=False)
    if not stash_list.stdout.strip():
        # Nothing queued, so there is no restore window to signal — the marker
        # written for the rebase step above is done once it lands.
        _clear_sync_marker()
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
    """Commit the version sync, then tag and push so the tag points at it.

    Called only after publish_marketplaces() has already succeeded (see
    _workflow.run_mode()'s full-publish pipeline), so this is the first point
    where a "(unreleased)" marker on this version's CHANGELOG heading is no
    longer true -- strip it here so the release commit itself records that
    the version is now actually out, not just cut.
    """
    header(f"GIT  (release v{version})")
    if strip_unreleased_marker(ROOT_CHANGELOG, version):
        success(f"Stripped the '(unreleased)' marker from [{version}] in CHANGELOG.md")
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

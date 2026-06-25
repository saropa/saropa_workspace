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

import subprocess

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
)
from modules._version_changelog import extract_changelog_section


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

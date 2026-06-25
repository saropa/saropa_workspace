#!/usr/bin/env python3
"""
package.json / CHANGELOG version helpers and the version-resolution workflow.

The single source of truth for the version is extension/package.json; release
notes live in the top "## [x.y.z]" section of the root CHANGELOG.md. This module
reads and reconciles those two, drives the interactive version prompt, and bumps
past any tag that already exists on the remote so a release can never collide
with a published one.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from modules._timing import StepTimer
from modules._utils import (
    Color,
    GITHUB_REPO,
    PACKAGE_JSON,
    ROOT_CHANGELOG,
    VERSION_RE,
    _c,
    detail,
    error,
    header,
    run,
    success,
    warn,
)


# --------------------------------------------------------------------------- #
# package.json / CHANGELOG version helpers (single source of truth).
# --------------------------------------------------------------------------- #


def read_package_version() -> str:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = data.get("version")
    if not version:
        raise ValueError("extension/package.json has no 'version' field")
    return version


def set_package_version(new_version: str) -> None:
    """Write a new version into package.json, touching only the version field.

    A targeted regex (not a json.dump round-trip) preserves the file's exact
    formatting, key order, and trailing newline so the diff is one line.
    """
    text = PACKAGE_JSON.read_text(encoding="utf-8")
    new_text, n = re.subn(
        r'("version"\s*:\s*")[^"]*(")', rf"\g<1>{new_version}\g<2>", text, count=1
    )
    if n == 0:
        raise ValueError("Could not find a 'version' field to update in package.json")
    PACKAGE_JSON.write_text(new_text, encoding="utf-8")


def top_changelog_version(changelog: Path) -> str | None:
    """Return the version in the first '## [x.y.z]' heading, or None.

    '## [Unreleased]' is skipped so a full publish forces a real cut version.
    Anchored to line start so a version-like token inside prose or a code span
    can't match before the first real heading.
    """
    if not changelog.exists():
        return None
    match = re.search(rf"^##\s*\[({VERSION_RE})\]", changelog.read_text(encoding="utf-8"), re.MULTILINE)
    return match.group(1) if match else None


def has_unreleased_section(changelog: Path) -> bool:
    if not changelog.exists():
        return False
    return bool(re.search(r"^##\s*\[Unreleased\]", changelog.read_text(encoding="utf-8"), re.MULTILINE))


def parse_version(version: str) -> tuple:
    """Sort key where a pre-release sorts before the matching stable version."""
    match = re.match(r"^(\d+\.\d+\.\d+)(?:-(.+))?$", version)
    if not match:
        raise ValueError(f"Invalid version: {version}")
    base = tuple(int(x) for x in match.group(1).split("."))
    pre = match.group(2)
    return (*base, 0, pre) if pre is not None else (*base, 1, "")


def increment_version(version: str) -> str:
    """Patch bump: 1.0.1 -> 1.0.2; 1.0.0-beta.1 -> 1.0.0-beta.2."""
    pre = re.match(r"^(\d+\.\d+\.\d+-\w+\.)(\d+)$", version)
    if pre:
        return f"{pre.group(1)}{int(pre.group(2)) + 1}"
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def find_empty_changelog_sections(changelog: Path) -> list[str]:
    """Return versions whose '## [x.y.z]' section has no body (orphan stubs).

    An empty stub between two real releases implies a version that never
    shipped, and it can trip the [Unreleased]->[version] rename into a false
    collision. '[Unreleased]' is intentionally not flagged — an empty
    Unreleased section is the normal state right after a release.
    """
    if not changelog.exists():
        return []
    content = changelog.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^##\s*\[({VERSION_RE})\][^\n]*\n(.*?)(?=^##\s|\Z)", re.MULTILINE | re.DOTALL
    )
    empty: list[str] = []
    for match in pattern.finditer(content):
        body = re.sub(r"^\s*(?:---\s*)?$", "", match.group(2), flags=re.MULTILINE)
        if not body.strip():
            empty.append(match.group(1))
    return empty


def rename_unreleased_to_version(changelog: Path, version: str) -> bool:
    """Rename the '## [Unreleased]' heading to '## [version]'.

    Returns True if renamed, False if there was no Unreleased heading. Raises
    ValueError if a section for the target version already exists (the author
    must resolve which one is real before a tag is burned on it).
    """
    content = changelog.read_text(encoding="utf-8")
    if not re.search(r"^##\s*\[Unreleased\]", content, re.MULTILINE):
        return False
    if re.search(rf"^##\s*\[{re.escape(version)}\]", content, re.MULTILINE):
        raise ValueError(
            f"CHANGELOG.md has both [Unreleased] and [{version}]. Remove one before publishing."
        )
    content = re.sub(r"^##\s*\[Unreleased\]", f"## [{version}]", content, count=1, flags=re.MULTILINE)
    changelog.write_text(content, encoding="utf-8")
    return True


def changelog_overview_problems(changelog: Path, version: str) -> list[str]:
    """Validate the '[version]' section's Overview intro and pinned [log] link.

    The CHANGELOG maintenance notes require every released section to open with
    a one-line human summary that ends in a [log](.../vX.Y.Z/CHANGELOG.md) link
    pinned to THIS version's tag. A missing intro ships a release with no
    summary; a stale tag in the link points readers at the wrong snapshot.
    """
    if not changelog.exists():
        return ["CHANGELOG.md not found."]
    content = changelog.read_text(encoding="utf-8")
    body_match = re.search(
        rf"^##\s*\[{re.escape(version)}\][^\n]*\n(.*?)(?=^##\s|\Z)",
        content,
        re.MULTILINE | re.DOTALL,
    )
    if body_match is None:
        return [f"No [{version}] section found in CHANGELOG.md."]
    # Overview is the prose before the first '###' sub-heading.
    intro = body_match.group(1).split("\n###", 1)[0]
    intro = re.sub(r"^\s*-{3,}\s*$", "", intro, flags=re.MULTILINE).strip()
    expected = f"[log](https://github.com/{GITHUB_REPO}/blob/v{version}/CHANGELOG.md)"
    log_match = re.search(r"\[log\]\(([^)]+)\)", intro)
    prose = re.sub(r"\[log\]\([^)]*\)", "", intro).strip()
    problems: list[str] = []
    if not prose:
        problems.append(f"The [{version}] section has no Overview intro paragraph.")
    if log_match is None:
        problems.append(f"The [{version}] Overview has no [log](...) link. End it with: {expected}")
    elif f"/blob/v{version}/" not in log_match.group(1):
        problems.append(
            f"The [{version}] [log] link does not point at tag v{version}. "
            f"Found {log_match.group(0)} -- expected {expected}"
        )
    return problems


def extract_changelog_section(changelog: Path, version: str) -> str | None:
    if not changelog.exists():
        return None
    pattern = re.compile(
        rf"^##\s*\[{re.escape(version)}\].*?$(.*?)(?=^##\s*\[|\Z)", re.MULTILINE | re.DOTALL
    )
    match = pattern.search(changelog.read_text(encoding="utf-8"))
    return match.group(1).strip() if match else None


# --------------------------------------------------------------------------- #
# Interactive version prompt (timeout; editable on Windows, bracketed on Unix).
# --------------------------------------------------------------------------- #


def _prompt_version_windows(default: str, timeout: int) -> str:
    import msvcrt

    sys.stdout.write(f"  Version to publish: {default}")
    sys.stdout.flush()
    buffer = list(default)
    start = time.time()
    while time.time() - start < timeout:
        if not msvcrt.kbhit():
            time.sleep(0.05)
            continue
        ch = msvcrt.getwch()
        if ch in ("\r", "\n"):
            print()
            return "".join(buffer).strip() or default
        if ch == "\x08":  # Backspace
            if buffer:
                buffer.pop()
                sys.stdout.write("\b \b")
                sys.stdout.flush()
        elif ch == "\x03":  # Ctrl+C
            raise KeyboardInterrupt
        elif ch.isprintable():
            buffer.append(ch)
            sys.stdout.write(ch)
            sys.stdout.flush()
    print()
    return "".join(buffer).strip() or default


def _prompt_version_unix(default: str, timeout: int) -> str:
    import select

    sys.stdout.write(f"  Version to publish [{default}]: ")
    sys.stdout.flush()
    ready, _, _ = select.select([sys.stdin], [], [], timeout)
    if not ready:
        print()
        return default
    return sys.stdin.readline().strip() or default


def prompt_version_until_valid(default: str, timeout: int = 60) -> str:
    """Prompt for a version, defaulting after a timeout, until it is valid semver."""
    while True:
        if sys.platform == "win32":
            version = _prompt_version_windows(default, timeout)
        else:
            version = _prompt_version_unix(default, timeout)
        if re.match(rf"^{VERSION_RE}$", version):
            return version
        warn(f"Invalid version '{version}'. Use X.Y.Z or X.Y.Z-pre.N")


def tag_exists_on_remote(version: str) -> bool:
    """True if tag v{version} already exists on origin (would collide on push)."""
    result = run(
        ["git", "ls-remote", "--tags", "origin", f"refs/tags/v{version}"],
        ROOT_CHANGELOG.parent,
        capture=True,
        check=False,
    )
    return bool(result.stdout.strip())


def resolve_version(timer: StepTimer) -> str | None:
    """Drive the full version-numbering workflow for a publish.

    1. Refuse to proceed while any '## [x.y.z]' section is an empty stub.
    2. Offer a default: a patch bump when [Unreleased] is present (work is
       pending), otherwise the current package.json value; never below the top
       changelog version if the author already cut one ahead by hand.
    3. Prompt (editable, with timeout); validate semver.
    4. Write package.json and rename [Unreleased] -> [version].
    5. Bump past a remote tag clash so a published version can't be reused.

    Returns the resolved version, or None to abort the publish.
    """
    header("VERSION")
    empty = find_empty_changelog_sections(ROOT_CHANGELOG)
    if empty:
        error(
            "CHANGELOG.md has empty version section(s): "
            + ", ".join(f"[{v}]" for v in empty)
            + ". Delete the stub or fill in its notes, then re-run."
        )
        return None

    pkg_version = read_package_version()
    default = increment_version(pkg_version) if has_unreleased_section(ROOT_CHANGELOG) else pkg_version
    top = top_changelog_version(ROOT_CHANGELOG)
    # Never offer a default below a release the author already wrote by hand.
    if top and parse_version(top) > parse_version(default):
        default = top
    detail(f"  Current package.json version: {pkg_version}")
    if has_unreleased_section(ROOT_CHANGELOG):
        detail("  CHANGELOG has an [Unreleased] section (work pending).")

    version = prompt_version_until_valid(default)

    with timer.step("Version sync"):
        if version != pkg_version:
            set_package_version(version)
            success(f"Set package.json to {version}")
        try:
            if rename_unreleased_to_version(ROOT_CHANGELOG, version):
                success(f"Renamed [Unreleased] to [{version}] in CHANGELOG.md")
        except ValueError as exc:
            error(str(exc))
            return None

        # Reconcile: after the rename the top changelog version must equal the
        # package version, or the published notes won't match the .vsix.
        new_top = top_changelog_version(ROOT_CHANGELOG)
        if new_top != version:
            error(
                f"After version sync, CHANGELOG top is [{new_top}] but package.json is "
                f"{version}. Add a [{version}] section with release notes and re-run."
            )
            return None

        # Bump past a tag that already exists on the remote so the push can't
        # fail mid-release on a duplicate tag.
        while tag_exists_on_remote(version):
            bumped = increment_version(version)
            warn(f"Tag v{version} already exists on origin; bumping to {bumped}.")
            set_package_version(bumped)
            content = ROOT_CHANGELOG.read_text(encoding="utf-8")
            content = re.sub(
                rf"^##\s*\[{re.escape(version)}\]",
                f"## [{bumped}]",
                content,
                count=1,
                flags=re.MULTILINE,
            )
            ROOT_CHANGELOG.write_text(content, encoding="utf-8")
            success(f"Promoted top CHANGELOG section [{version}] -> [{bumped}]")
            version = bumped

    detail(f"  Publishing: {_c(version, Color.WHITE)}    Tag: v{version}")
    return version

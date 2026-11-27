#!/usr/bin/env python3
"""
The two links that close each release's CHANGELOG overview, and their upkeep.

An overview ends with a GitHub [log] link pinned to the release's tag and a
saropa.com link to the release on the published changelog pages. Both carry the
version, and the saropa.com address also depends on which major is current, so
they go stale when a heading is renamed or bumped and when a new major ships.
This module computes the expected addresses, rewrites them, and reports the ones
that do not match. It takes paths and versions as arguments and reads no global
state, so it can run against temporary files.

Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import re
from pathlib import Path

from modules._utils import GITHUB_REPO, SAROPA_CHANGELOG_URL, VERSION_RE

_LOG_LINK_RE = r"\[log\]\([^)]*\)"
# Limited to the changelog pages, so another saropa.com link in prose is left alone.
_SITE_LINK_RE = rf"\[saropa\.com\]\({re.escape(SAROPA_CHANGELOG_URL)}[^)]*\)"

# Either link with the "·" before it. Removed before judging the prose, so a
# section that holds only links is not mistaken for one that has a summary.
OVERVIEW_LINK_RE = rf"\s*·?\s*(?:{_LOG_LINK_RE}|{_SITE_LINK_RE})"

# One release section: group 1 is the heading line, 2 its version, 3 the body.
# "[Unreleased]" has no version, so it is never matched.
_SECTION_RE = re.compile(
    rf"^(##[ \t]*\[({VERSION_RE})\][^\n]*\n)(.*?)(?=^##\s|\Z)", re.MULTILINE | re.DOTALL
)


def saropa_release_url(version: str, current_version: str) -> str:
    """Return the saropa.com changelog URL for one release.

    The current major lives on the main changelog page; an older major lives on
    its own "<N>.x/" page. Which file holds the entry makes no difference.
    """
    major = version.split(".", 1)[0]
    folder = "" if major == current_version.split(".", 1)[0] else f"{major}.x/"
    # The page's anchors cannot contain dots: 9.8.3 is published as #v9-8-3.
    return f"{SAROPA_CHANGELOG_URL}{folder}#v{version.replace('.', '-')}"


def _split_overview(body: str) -> tuple[str, str]:
    """Split a section body at its first '###' heading: (overview, the rest)."""
    start = body.find("\n###")
    return (body, "") if start < 0 else (body[:start], body[start:])


def _retarget(overview: str, version: str, current: str, pin_log: bool) -> str:
    """Return the overview with its link addresses recomputed for 'version'.

    'pin_log' is set only for the release being published: older entries keep
    whatever tag their [log] link was shipped with.
    """
    site = f"[saropa.com]({saropa_release_url(version, current)})"
    overview = re.sub(_SITE_LINK_RE, lambda _: site, overview)
    if pin_log:
        log = f"[log](https://github.com/{GITHUB_REPO}/blob/v{version}/CHANGELOG.md)"
        overview = re.sub(_LOG_LINK_RE, lambda _: log, overview)
    return overview


def sync_release_links(changelog: Path, current: str, released: str | None = None) -> bool:
    """Rewrite stale overview links in one changelog file.

    Every entry's saropa.com link is set from its heading and the 'current'
    version; the 'released' entry also has its [log] link pinned to its tag.
    Missing links are not added (the validation reports them). Returns True if
    the file changed.
    """
    if not changelog.exists():
        return False
    # Bytes rather than text mode, so the file keeps its own line endings.
    content = changelog.read_bytes().decode("utf-8")

    def _replace(match: re.Match) -> str:
        heading, version, body = match.groups()
        overview, rest = _split_overview(body)
        return heading + _retarget(overview, version, current, version == released) + rest

    updated = _SECTION_RE.sub(_replace, content)
    if updated == content:
        return False
    changelog.write_bytes(updated.encode("utf-8"))
    return True


def stale_site_link_problems(changelog: Path, current: str, skip: str | None = None) -> list[str]:
    """Report every entry whose overview lacks its expected saropa.com link.

    'skip' names a version the caller already validates, to avoid reporting it twice.
    """
    if not changelog.exists():
        return []
    problems: list[str] = []
    for match in _SECTION_RE.finditer(changelog.read_text(encoding="utf-8")):
        _, version, body = match.groups()
        expected = f"[saropa.com]({saropa_release_url(version, current)})"
        if version != skip and expected not in _split_overview(body)[0]:
            problems.append(f"{changelog.name} [{version}] needs the link {expected}")
    return problems

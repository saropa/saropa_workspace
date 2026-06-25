#!/usr/bin/env python3
"""
Read-only pre-publish audit: the gate a full publish must pass.

Checks the version/changelog agreement, the absence of empty changelog stubs,
the Overview intro + pinned [log] link on the cut version, i18n key coverage for
both catalogs (manifest %key% and runtime l10n('key')), and that no
AI-authorship attribution footer leaked into a tracked, shippable file.

Returns a count of BLOCKING failures (0 = clean). Code-quality metrics (file
length, comment coverage, test coverage) live in _quality.py and are gated
separately so this module stays focused on release correctness.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import re

from modules._utils import (
    PACKAGE_JSON,
    PACKAGE_NLS,
    REPO_ROOT,
    ROOT_CHANGELOG,
    RUNTIME_LOCALE,
    SRC_DIR,
    detail,
    error,
    header,
    info,
    run,
    success,
)
from modules._version_changelog import (
    changelog_overview_problems,
    find_empty_changelog_sections,
    has_unreleased_section,
    read_package_version,
    top_changelog_version,
)

# AI-authorship attribution that must never leak into a tracked, shippable
# artifact (HARD RULE in CLAUDE.md / .claude/rules: no "Generated with",
# "Co-Authored-By: Claude", etc.). The scan targets the canonical attribution
# FOOTER forms only — not the words "AI" or "Claude" themselves, because this
# extension legitimately ships an "Active AI Threads" feature that surfaces
# Claude/AI chat sessions, so those words appear all over the product on
# purpose. Only the attribution footer is a real leak.
ATTRIBUTION_RE = re.compile(
    r"(Co-Authored-By:\s*Claude)"
    r"|(noreply@anthropic\.com)"
    r"|(Generated with \[?Claude)"
    r"|(\U0001F916 Generated with)",
    re.IGNORECASE,
)


def _used_nls_keys() -> set[str]:
    """All %key% manifest tokens referenced by package.json."""
    if not PACKAGE_JSON.exists():
        return set()
    return set(re.findall(r"%([A-Za-z0-9_.]+)%", PACKAGE_JSON.read_text(encoding="utf-8")))


def _defined_nls_keys() -> set[str]:
    if not PACKAGE_NLS.exists():
        return set()
    return set(json.loads(PACKAGE_NLS.read_text(encoding="utf-8")).keys())


def _used_l10n_keys() -> set[str]:
    """All l10n('key') runtime tokens referenced anywhere under src/."""
    keys: set[str] = set()
    for ts in SRC_DIR.rglob("*.ts"):
        for match in re.finditer(r"""l10n\(\s*['"]([A-Za-z0-9_.]+)['"]""", ts.read_text(encoding="utf-8")):
            keys.add(match.group(1))
    return keys


def _defined_l10n_keys() -> set[str]:
    if not RUNTIME_LOCALE.exists():
        return set()
    return set(json.loads(RUNTIME_LOCALE.read_text(encoding="utf-8")).keys())


def scan_attribution_leaks() -> list[str]:
    """Return tracked files containing an AI-authorship attribution footer.

    The 'no AI on public surfaces' rule is a hard requirement: nothing shipped
    to GitHub or the Marketplace may credit a tool as author. This scans for the
    canonical attribution footer (see ATTRIBUTION_RE) rather than the word
    "Claude", because the extension's AI-threads feature names those tools on
    purpose. git grep searches only tracked files, so git-ignored working notes
    (CLAUDE.md, .claude/) are excluded automatically; binaries are excluded by
    pathspec to avoid match noise.
    """
    result = run(
        [
            "git",
            "grep",
            "-iIl",
            "-E",
            ATTRIBUTION_RE.pattern,
            "--",
            ":(exclude)*.vsix",
            ":(exclude)*.png",
            ":(exclude)*.ico",
            # This module necessarily contains the attribution patterns it
            # searches for, as literal regex source — exclude it from its scan.
            ":(exclude)scripts/modules/_audit.py",
        ],
        REPO_ROOT,
        capture=True,
        check=False,
    )
    return [line for line in result.stdout.splitlines() if line.strip()]


def run_audit(mode: str) -> int:
    """Run read-only pre-publish checks. Returns the number of blocking failures.

    For non-full modes the version/changelog match is informational rather than
    blocking, so verification builds aren't forced to cut a release first.
    """
    header("AUDIT")
    failures = 0
    strict = mode == "full"

    # 1) Version / changelog agreement.
    version = read_package_version()
    top = top_changelog_version(ROOT_CHANGELOG)
    if has_unreleased_section(ROOT_CHANGELOG):
        if strict:
            info("CHANGELOG has [Unreleased]; a full publish will cut it to a version.")
        else:
            info("CHANGELOG has an [Unreleased] section.")
    if top is None:
        msg = "CHANGELOG.md has no '## [x.y.z]' heading."
        (error if strict else info)(msg)
        failures += int(strict)
    elif top != version and not has_unreleased_section(ROOT_CHANGELOG):
        msg = f"Version mismatch: package.json {version} != CHANGELOG top {top}."
        (error if strict else info)(msg)
        failures += int(strict)
    else:
        success(f"Version source of truth: package.json {version}")

    # 2) No empty changelog stubs (silent-skip guard).
    empty = find_empty_changelog_sections(ROOT_CHANGELOG)
    if empty:
        error("Empty CHANGELOG section(s): " + ", ".join(f"[{v}]" for v in empty))
        failures += 1
    else:
        success("No empty CHANGELOG sections.")

    # 3) Overview intro + pinned [log] link on the cut version (strict only;
    #    until [Unreleased] is cut the pinned tag can't be known).
    if strict and top and not has_unreleased_section(ROOT_CHANGELOG):
        problems = changelog_overview_problems(ROOT_CHANGELOG, top)
        if problems:
            for p in problems:
                error(p)
            failures += len(problems)
        else:
            success(f"[{top}] Overview intro and [log] link valid.")

    # 4) i18n manifest coverage: every %key% has a value in package.nls.json.
    missing_nls = sorted(_used_nls_keys() - _defined_nls_keys())
    if missing_nls:
        error(f"package.json uses {len(missing_nls)} %key% with no value in package.nls.json:")
        for k in missing_nls[:20]:
            detail(f"      %{k}%")
        failures += 1
    else:
        success("All package.json %keys% are defined in package.nls.json.")

    # 5) i18n runtime coverage: every l10n('key') has a value in locales/en.json.
    missing_l10n = sorted(_used_l10n_keys() - _defined_l10n_keys())
    if missing_l10n:
        error(f"Code uses {len(missing_l10n)} l10n key(s) with no value in locales/en.json:")
        for k in missing_l10n[:20]:
            detail(f"      {k}")
        failures += 1
    else:
        success("All l10n('key') calls are defined in locales/en.json.")

    # 6) No AI-authorship attribution footer in tracked, shippable files (hard rule).
    flagged = scan_attribution_leaks()
    if flagged:
        error("AI-authorship attribution leaked into tracked file(s):")
        for f in flagged:
            detail(f"      {f}")
        failures += 1
    else:
        success("No AI-authorship attribution in tracked files.")

    print()
    if failures:
        error(f"Audit found {failures} blocking issue(s).")
    else:
        success("Audit clean.")
    return failures

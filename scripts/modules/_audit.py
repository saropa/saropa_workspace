#!/usr/bin/env python3
"""
Read-only pre-publish audit: the gate a full publish must pass.

Checks the version/changelog agreement, the absence of empty changelog stubs,
the Overview intro + pinned [log] link on the cut version, and i18n key coverage
for both catalogs (manifest %key% and runtime l10n('key')).

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
    ROOT_CHANGELOG,
    RUNTIME_LOCALE,
    SRC_DIR,
    detail,
    error,
    header,
    info,
    success,
)
from modules._version_changelog import (
    changelog_overview_problems,
    find_empty_changelog_sections,
    has_unreleased_section,
    read_package_version,
    top_changelog_version,
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
    """All l10n('key') runtime tokens referenced by production code under src/.

    Test files (src/test/**) are skipped: the l10n unit tests deliberately pass
    bogus keys (e.g. 'this.key.does.not.exist') to exercise the missing-key
    fallback, where l10n returns the key itself. Those fixtures must NOT be
    required to exist in the catalog, or the audit would flag them as missing
    translations when they are intentional negative cases.
    """
    keys: set[str] = set()
    for ts in SRC_DIR.rglob("*.ts"):
        if "test" in ts.relative_to(SRC_DIR).parts:
            continue
        for match in re.finditer(r"""l10n\(\s*['"]([A-Za-z0-9_.]+)['"]""", ts.read_text(encoding="utf-8")):
            keys.add(match.group(1))
    return keys


def _defined_l10n_keys() -> set[str]:
    if not RUNTIME_LOCALE.exists():
        return set()
    return set(json.loads(RUNTIME_LOCALE.read_text(encoding="utf-8")).keys())


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
        # CHANGELOG is the version source of truth; package.json is reconciled to
        # it. A mismatch is informational, not blocking, even for a full publish:
        # the VERSION step defaults to the CHANGELOG version and prompts the
        # author to confirm or overwrite it, then writes package.json. Blocking
        # here would dead-end exactly the case the version step exists to resolve.
        info(
            f"package.json {version} != CHANGELOG top {top}; the version step will "
            f"set package.json to {top} (confirm or overwrite)."
        )
    else:
        success(f"Version source of truth: CHANGELOG {top or version}")

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

    print()
    if failures:
        error(f"Audit found {failures} blocking issue(s).")
    else:
        success("Audit clean.")
    return failures

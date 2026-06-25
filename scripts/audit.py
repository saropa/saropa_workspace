#!/usr/bin/env python3
"""
Audit the Saropa Workspace extension — quality and release-readiness, no publish.

Standalone read-only checker. Runs the same two gates publish.py runs before a
full release, but changes nothing and never touches git or the stores:

    1. Release-correctness audit (modules/_audit.py)
       version <-> changelog agreement, empty-changelog-stub guard, the cut
       section's Overview intro + pinned [log] link, i18n key coverage for both
       catalogs, and the no-AI-attribution hard rule.

    2. Code-quality report (modules/_quality.py)
       file length, function length (heuristic), comment-line density and
       exported-symbol JSDoc coverage, unit test coverage, `any` usage,
       TODO/FIXME/HACK debt, and hardcoded show*Message() strings.

Run from anywhere in the repo:

    python scripts/audit.py            # full audit (quality is informational)
    python scripts/audit.py --strict   # quality hard-cap violations also fail
    python scripts/audit.py --quality  # quality report only
    python scripts/audit.py --release  # release-correctness audit only

Exit codes:
    0  Clean (no blocking issues)
    3  One or more blocking issues found
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add scripts/ to sys.path so `modules.*` resolves no matter the caller's cwd.
_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules._audit import run_audit  # noqa: E402
from modules._quality import run_quality_audit  # noqa: E402
from modules._utils import enable_ansi_support, header, set_quiet, show_logo, success, error  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit the Saropa Workspace extension (read-only).")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--quality", action="store_true", help="Run only the code-quality report.")
    group.add_argument("--release", action="store_true", help="Run only the release-correctness audit.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Quality hard-cap violations (oversized files) count as blocking failures.",
    )
    parser.add_argument("--quiet", action="store_true", help="Only print warnings and errors.")
    parsed = parser.parse_args()
    set_quiet(parsed.quiet)

    enable_ansi_support()
    show_logo()

    failures = 0

    # The release audit's strict path mirrors a full publish (version/changelog
    # must agree). audit.py treats it as strict so a desync is reported as a
    # blocking issue rather than silently passing.
    if not parsed.quality:
        failures += run_audit("full")

    if not parsed.release:
        failures += run_quality_audit(strict=parsed.strict)

    header("AUDIT SUMMARY")
    if failures:
        error(f"{failures} blocking issue(s) found.")
        return 3
    success("No blocking issues.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Validate FILE_MAPPING_DECORATION.md against the installed VS Code codicon set.

Checks:
  1. Every icon name in the plan is a valid VS Code codicon.
  2. Every regex pattern in the plan is syntactically valid.
  3. No duplicate entries (same regex or same extension appearing twice).

The codicon reference is extracted from the VS Code installation's bundled
codicon.css. If VS Code is not installed at the standard location, pass
--codicon-css <path> to point at any codicon.css file.

Run from anywhere in the repo:

    python scripts/validate_file_mappings.py
    python scripts/validate_file_mappings.py --codicon-css path/to/codicon.css

Exit codes:
    0  All checks passed
    1  One or more issues found
    2  Could not locate codicon.css (pass --codicon-css explicitly)
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PLAN_PATH = REPO_ROOT / "plans" / "FILE_MAPPING_DECORATION.md"

# Standard VS Code install paths (Windows, macOS, Linux).
_VSCODE_ROOTS = [
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code",
    Path("/Applications/Visual Studio Code.app/Contents/Resources/app"),
    Path("/usr/share/code"),
    Path("/usr/lib/code"),
]


def _find_codicon_css() -> Path | None:
    """Walk VS Code install dirs for any bundled codicon.css."""
    for root in _VSCODE_ROOTS:
        if not root.is_dir():
            continue
        # glob through the versioned subdirectory structure
        for hit in root.rglob("codicon.css"):
            return hit
    return None


def _parse_codicon_names(css_path: Path) -> set[str]:
    """Extract codicon glyph names from a codicon.css file."""
    text = css_path.read_text(encoding="utf-8", errors="replace")
    return set(re.findall(r"\.codicon-([a-z0-9-]+):before", text))


# Matches a 4-column table row: | label | `regex` | color | icon |
_ROW_4COL = re.compile(
    r"^\|[^|]+\|[^|]*`([^`]+)`[^|]*\|[^|]+\|\s*([a-z][a-z0-9-]*)\s*\|$"
)

# Matches a 3-column table row (extension tables): | .ext | color | icon |
_ROW_3COL = re.compile(
    r"^\|\s*(\.\w+)\s*\|[^|]+\|\s*([a-z][a-z0-9-]*)\s*\|$"
)


def _parse_plan(plan_path: Path) -> list[dict]:
    """Parse the plan into a list of entries with line number, icon, and regex/ext."""
    entries: list[dict] = []
    for lineno, line in enumerate(plan_path.read_text(encoding="utf-8").splitlines(), 1):
        m4 = _ROW_4COL.match(line)
        if m4:
            entries.append({
                "line": lineno,
                "regex": m4.group(1),
                "icon": m4.group(2),
                "ext": None,
                "raw": line.strip(),
            })
            continue
        m3 = _ROW_3COL.match(line)
        if m3:
            entries.append({
                "line": lineno,
                "regex": None,
                "icon": m3.group(2),
                "ext": m3.group(1).lower(),
                "raw": line.strip(),
            })
    return entries


def validate(plan_path: Path, codicon_names: set[str]) -> list[str]:
    """Return a list of human-readable issue strings."""
    entries = _parse_plan(plan_path)
    issues: list[str] = []

    seen_regexes: dict[str, int] = {}
    seen_exts: dict[str, int] = {}

    for e in entries:
        # Icon validity
        if e["icon"] not in codicon_names:
            issues.append(
                f"line {e['line']}: unknown codicon \"{e['icon']}\" "
                f"(not in codicon.css)"
            )

        # Regex syntax
        if e["regex"]:
            try:
                re.compile(e["regex"])
            except re.error as exc:
                issues.append(
                    f"line {e['line']}: invalid regex `{e['regex']}` — {exc}"
                )

            # Duplicate regex
            if e["regex"] in seen_regexes:
                issues.append(
                    f"line {e['line']}: duplicate regex `{e['regex']}` "
                    f"(first seen line {seen_regexes[e['regex']]})"
                )
            else:
                seen_regexes[e["regex"]] = e["line"]

        # Duplicate extension
        if e["ext"]:
            if e["ext"] in seen_exts:
                issues.append(
                    f"line {e['line']}: duplicate extension \"{e['ext']}\" "
                    f"(first seen line {seen_exts[e['ext']]})"
                )
            else:
                seen_exts[e["ext"]] = e["line"]

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--codicon-css",
        type=Path,
        default=None,
        help="Path to a codicon.css file (auto-detected from VS Code install if omitted)",
    )
    parser.add_argument(
        "--plan",
        type=Path,
        default=PLAN_PATH,
        help=f"Path to FILE_MAPPING_DECORATION.md (default: {PLAN_PATH})",
    )
    args = parser.parse_args()

    # Locate codicon.css
    css_path: Path | None = args.codicon_css
    if css_path is None:
        css_path = _find_codicon_css()
    if css_path is None or not css_path.is_file():
        print(
            "ERROR: could not locate codicon.css. "
            "Pass --codicon-css <path> explicitly.",
            file=sys.stderr,
        )
        return 2

    codicon_names = _parse_codicon_names(css_path)
    print(f"Loaded {len(codicon_names)} codicon names from {css_path}")

    if not args.plan.is_file():
        print(f"ERROR: plan file not found: {args.plan}", file=sys.stderr)
        return 2

    issues = validate(args.plan, codicon_names)

    if not issues:
        print("All checks passed.")
        return 0

    print(f"\n{len(issues)} issue(s) found:\n")
    for issue in issues:
        print(f"  {issue}")
    return 1


if __name__ == "__main__":
    sys.exit(main())

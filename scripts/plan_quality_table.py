#!/usr/bin/env python3
"""
Refresh the "Now" column of the quality plan's size table from the live gate.

The plan lists files that missed their size targets with a measured line count.
Those counts go stale the moment any of the files changes, so this script re-runs
the gate's own measurer (modules._quality.collect_quality, the same code that
`audit.py --quality` uses, so no output is parsed and no second opinion exists)
and rewrites only the "Now" cell of each row between the table markers.

Usage:
    python scripts/plan_quality_table.py            # print the refreshed table
    python scripts/plan_quality_table.py --write    # rewrite the plan in place

Exit code 0 on success; 1 when the markers are missing or a row names a file the
gate does not measure (a renamed or deleted file must be fixed in the plan).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Make `modules` importable the same way the other entry scripts do.
_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules._quality import FUNCTION_LINES_WARN, collect_quality  # noqa: E402

PLAN_PATH = Path(_SCRIPTS_DIR).parent / "plans" / "PLAN_CODE_QUALITY_RELEASE_BOARD_remaining.md"
START_MARKER = "<!-- quality-table:start -->"
END_MARKER = "<!-- quality-table:end -->"

# A data row: | `file` or file | now | target | plan... |. The header and the
# separator row never match because their second cell is not a number.
_ROW_RE = re.compile(r"^\|\s*(?P<file>[^|]+?)\s*\|\s*(?P<now>\d+)\s*\|(?P<rest>.*)$")


def refresh_table(block: str, lines_by_file: dict[str, int]) -> tuple[str, list[str]]:
    """Return the block with each row's Now cell replaced, plus unmeasured names.

    `lines_by_file` maps a path relative to `extension/src/` to its line count.
    A row whose file is absent is kept untouched and reported, so a stale row is
    surfaced instead of silently keeping an old number.
    """
    missing: list[str] = []
    out: list[str] = []
    for line in block.splitlines():
        match = _ROW_RE.match(line)
        if match is None:
            out.append(line)
            continue
        name = match.group("file").strip("`")
        measured = lines_by_file.get(name)
        if measured is None:
            missing.append(name)
            out.append(line)
            continue
        out.append(f"| {match.group('file')} | {measured} |{match.group('rest')}")
    return "\n".join(out), missing


def replace_block(text: str, new_block: str) -> str | None:
    """Swap the text between the markers; None when a marker is absent."""
    start = text.find(START_MARKER)
    end = text.find(END_MARKER)
    if start == -1 or end == -1 or end < start:
        return None
    head = text[: start + len(START_MARKER)]
    return f"{head}\n{new_block}\n{text[end:]}"


def extract_block(text: str) -> str | None:
    """Text between the markers, or None when a marker is absent."""
    start = text.find(START_MARKER)
    end = text.find(END_MARKER)
    if start == -1 or end == -1 or end < start:
        return None
    return text[start + len(START_MARKER) : end].strip("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write", action="store_true", help="Rewrite the plan in place.")
    args = parser.parse_args()

    text = PLAN_PATH.read_text(encoding="utf-8")
    block = extract_block(text)
    if block is None:
        print(f"Markers {START_MARKER} / {END_MARKER} not found in {PLAN_PATH}", file=sys.stderr)
        return 1

    report = collect_quality()
    # Gate paths read "src/board/x.ts"; plan rows omit the "src/" prefix.
    lines_by_file = {f.rel_path.removeprefix("src/"): f.lines for f in report.files}
    new_block, missing = refresh_table(block, lines_by_file)
    print(new_block)

    # Functions over the limit are listed for the reader; they live in prose in the
    # plan, so they are reported here rather than rewritten.
    long_fns = [(f.rel_path, n, s) for f in report.files for n, s in f.long_functions]
    print(f"\n{len(long_fns)} function(s) over {FUNCTION_LINES_WARN} code lines:")
    for rel, name, span in sorted(long_fns, key=lambda t: -t[2]):
        print(f"  {span:>4}  {name}  ({rel})")

    if missing:
        print(f"\nRows naming unmeasured files: {', '.join(missing)}", file=sys.stderr)
    if args.write:
        updated = replace_block(text, new_block)
        if updated is None:
            return 1
        PLAN_PATH.write_text(updated, encoding="utf-8")
        print(f"\nRewrote {PLAN_PATH}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())

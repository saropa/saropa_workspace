#!/usr/bin/env python3
"""
Tests for scripts/plan_quality_table.py: the table refresh must change only the
Now cell, keep every other cell, and report rows the gate does not measure.

Run:  python scripts/tests/test_plan_quality_table.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Make `plan_quality_table` and `modules` importable like the sibling tests do.
_SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from plan_quality_table import (  # noqa: E402
    END_MARKER,
    START_MARKER,
    extract_block,
    refresh_table,
    replace_block,
)

TABLE = "\n".join(
    [
        "| File | Now | Target | Plan |",
        "|---|---|---|---|",
        "| board/a.ts | 361 | under 330 | split it |",
        "| views/gone.ts | 432 | under 390 | leave |",
    ]
)


class RefreshTableTests(unittest.TestCase):
    def test_updates_only_the_now_cell(self) -> None:
        out, missing = refresh_table(TABLE, {"board/a.ts": 300})
        self.assertIn("| board/a.ts | 300 | under 330 | split it |", out)
        self.assertEqual(missing, ["views/gone.ts"])

    def test_keeps_header_and_separator_and_unmeasured_row(self) -> None:
        out, _ = refresh_table(TABLE, {"board/a.ts": 300})
        self.assertIn("| File | Now | Target | Plan |", out)
        self.assertIn("|---|---|---|---|", out)
        self.assertIn("| views/gone.ts | 432 | under 390 | leave |", out)

    def test_backticked_names_match(self) -> None:
        out, missing = refresh_table("| `board/a.ts` | 1 | x | y |", {"board/a.ts": 7})
        self.assertEqual(missing, [])
        self.assertIn("| `board/a.ts` | 7 | x | y |", out)


class MarkerTests(unittest.TestCase):
    def test_round_trip_replaces_only_between_markers(self) -> None:
        text = f"before\n{START_MARKER}\nold\n{END_MARKER}\nafter\n"
        self.assertEqual(extract_block(text), "old")
        self.assertEqual(
            replace_block(text, "new"),
            f"before\n{START_MARKER}\nnew\n{END_MARKER}\nafter\n",
        )

    def test_missing_markers_return_none(self) -> None:
        self.assertIsNone(extract_block("no markers"))
        self.assertIsNone(replace_block("no markers", "x"))


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Date extraction for the organize-output script.

A file is grouped by a date parsed from its name when one is present; the caller
falls back to the file's creation time otherwise. Split into its own module so the
parsing rules (and their regexes) sit apart from the move/prune logic and can be
tested on their own.
"""

from __future__ import annotations

import re
from datetime import datetime

# Filename date shapes seen across common generator/logging conventions. Order is
# significant: parsing stops at the FIRST pattern that yields a valid calendar
# date, so the separator form is tried before the bare 8-digit run to avoid a
# 6-digit time being misread as a date.
_DATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # 2026-05-06 / 2026.05.06 / 2026_05_06 — word-boundary guarded so it does not
    # bite into a longer digit run.
    re.compile(r"(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)"),
    # 20260506
    re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)"),
)


def parse_date_from_name(filename: str) -> datetime | None:
    """Return the first plausible calendar date found in ``filename``, or None.

    Left-to-right, first valid match wins — the conventions above put the date
    ahead of any time component, so this is deterministic for the common cases.
    An impossible date (month 13, day 32) is rejected and parsing continues to the
    next pattern rather than raising.
    """
    for pattern in _DATE_PATTERNS:
        match = pattern.search(filename)
        if not match:
            continue
        year, month, day = map(int, match.groups())
        try:
            return datetime(year, month, day)
        except ValueError:
            # A syntactically-matched but invalid date (e.g. 2026.13.40): keep
            # looking rather than treating it as the file's date.
            continue
    return None

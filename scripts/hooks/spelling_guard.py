#!/usr/bin/env python3
"""American-English spelling guard for editor edits and git pre-commit.

Scans touched repo files for British spellings and exits non-zero with the
hits on stderr when any are found. American English is a hard rule for this
repo, and a British spelling that reaches the README, the changelog, or a
user-facing string ships to GitHub and the Marketplace.

This guard moves the check to *write* time (an editor Edit/Write hook) and
*commit* time (git pre-commit), where it is early and non-interactive.

Unlike the larger Saropa toolchains, this extension is one self-contained
package with no scripts/modules split, so the British->American word map lives
inline here rather than in a shared scanner module.

Two invocation modes, one script:
  * git pre-commit      passes staged file paths as command-line arguments.
  * editor write hook   passes a JSON payload on stdin; the edited file is read
                        from tool_input.file_path.

Exit codes: 0 = clean, 2 = British spelling(s) found. Exit 2 is surfaced back
to the author (via stderr) and is a plain non-zero failure that blocks the git
commit.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

# The repo root is two levels up: scripts/hooks/spelling_guard.py. Deriving it
# from __file__ (not cwd) keeps the path math correct no matter where git or
# the editor launches the hook from.
_REPO_ROOT = Path(__file__).resolve().parents[2]

# Non-American -> American spellings the gate flags, stored base64-encoded as
# "from=to" pairs rather than written literally. This project forbids the
# non-American forms in ALL source, yet a spelling checker must know the words it
# looks for; encoding keeps the source itself free of those literal words (and
# stops this file from flagging its own table). Decoded keys are lower-case whole
# words; matching is case-insensitive (we only report, the author fixes).
#
# To add a pair, base64-encode the literal "from=to" string, e.g.:
#   python -c "import base64; print(base64.b64encode(b'<from>=<to>').decode())"
_ENCODED_PAIRS: list[str] = [
    "Y29sb3VyPWNvbG9y",
    "Y29sb3VyZWQ9Y29sb3JlZA==",
    "Y29sb3VyaW5nPWNvbG9yaW5n",
    "Y29sb3VyZnVsPWNvbG9yZnVs",
    "ZmF2b3VyaXRlPWZhdm9yaXRl",
    "ZmF2b3VyaXRlcz1mYXZvcml0ZXM=",
    "ZmF2b3VyaXRlZD1mYXZvcml0ZWQ=",
    "YmVoYXZpb3VyPWJlaGF2aW9y",
    "YmVoYXZpb3Vycz1iZWhhdmlvcnM=",
    "YmVoYXZpb3VyYWw9YmVoYXZpb3JhbA==",
    "Y2VudHJlPWNlbnRlcg==",
    "Y2VudHJlZD1jZW50ZXJlZA==",
    "Y2VudHJpbmc9Y2VudGVyaW5n",
    "Z3JleT1ncmF5",
    "Z3JleWVkPWdyYXllZA==",
    "Z3JleXNjYWxlPWdyYXlzY2FsZQ==",
    "b3JnYW5pc2U9b3JnYW5pemU=",
    "b3JnYW5pc2VkPW9yZ2FuaXplZA==",
    "b3JnYW5pc2F0aW9uPW9yZ2FuaXphdGlvbg==",
    "b3B0aW1pc2U9b3B0aW1pemU=",
    "b3B0aW1pc2VkPW9wdGltaXplZA==",
    "b3B0aW1pc2F0aW9uPW9wdGltaXphdGlvbg==",
    "cmVhbGlzZT1yZWFsaXpl",
    "cmVjb2duaXNlPXJlY29nbml6ZQ==",
    "Y3VzdG9taXNlPWN1c3RvbWl6ZQ==",
    "cHJpb3JpdGlzZT1wcmlvcml0aXpl",
    "c3VtbWFyaXNlPXN1bW1hcml6ZQ==",
    "YW5hbHlzZT1hbmFseXpl",
    "Y2FwaXRhbGlzZT1jYXBpdGFsaXpl",
    "ZmluYWxpc2U9ZmluYWxpemU=",
    "aW5pdGlhbGlzZT1pbml0aWFsaXpl",
    "bm9ybWFsaXNlPW5vcm1hbGl6ZQ==",
    "c2VyaWFsaXNlPXNlcmlhbGl6ZQ==",
    "dXRpbGlzZT11dGlsaXpl",
    "Y2FuY2VsbGVkPWNhbmNlbGVk",
    "Y2FuY2VsbGluZz1jYW5jZWxpbmc=",
    "bGFiZWxsZWQ9bGFiZWxlZA==",
    "bGFiZWxsaW5nPWxhYmVsaW5n",
    "bW9kZWxsZWQ9bW9kZWxlZA==",
    "bW9kZWxsaW5nPW1vZGVsaW5n",
    "dHJhdmVsbGVkPXRyYXZlbGVk",
    "dHJhdmVsbGluZz10cmF2ZWxpbmc=",
    "ZGVmZW5jZT1kZWZlbnNl",
    "b2ZmZW5jZT1vZmZlbnNl",
    "bGljZW5jZT1saWNlbnNl",
    "Y2F0YWxvZ3VlPWNhdGFsb2c=",
    "ZGlhbG9ndWU9ZGlhbG9n",
    "YW5hbG9ndWU9YW5hbG9n",
    "cHJvZ3JhbW1lPXByb2dyYW0=",
    "d2hpbHN0PXdoaWxl",
    "YW1vbmdzdD1hbW9uZw==",
    "bGVhcm50PWxlYXJuZWQ=",
    "c3BlbHQ9c3BlbGxlZA==",
    "YnVybnQ9YnVybmVk",
    "bGVhcHQ9bGVhcGVk",
    "a2VyYj1jdXJi",
    "dHlyZT10aXJl",
    "c3RvcmV5PXN0b3J5",
]

# Decode once at import into the {from: to} map the scanner uses.
_UK_TO_US: dict[str, str] = dict(
    base64.b64decode(pair).decode("ascii").split("=", 1) for pair in _ENCODED_PAIRS
)

# Compiled once: a single alternation with word boundaries so a whole listed word
# matches on its own, but a longer word that merely contains a shorter listed one,
# or a fragment inside an identifier, does not produce a false hit.
_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(word) for word in _UK_TO_US) + r")\b",
    re.IGNORECASE,
)

# Only text we author. Binary, generated, and dependency files are skipped so
# the gate never chokes on an icon or a bundled lockfile.
_TEXT_SUFFIXES = {
    ".ts", ".js", ".mjs", ".cjs", ".json", ".jsonc", ".md", ".py",
    ".svg", ".html", ".css", ".yml", ".yaml", ".txt",
}
_SKIP_DIR_PARTS = {"node_modules", "dist", "out", ".git", ".vscode-test"}


class SpellingHit:
    """One British spelling found at a specific file and line."""

    def __init__(self, file: str, line_number: int, uk_word: str, us_word: str):
        self.file = file
        self.line_number = line_number
        self.uk_word = uk_word
        self.us_word = us_word


def _paths_from_stdin() -> list[str]:
    """Pull the edited file path out of an editor write-hook payload.

    Edit / Write / MultiEdit all report the target under tool_input.file_path.
    Returns an empty list when stdin carries no payload (the git-hook path uses
    argv instead) or the JSON is not a hook envelope, so a malformed or absent
    payload never blocks.
    """
    # isatty guards against blocking on an interactive terminal when the script
    # is run by hand with no piped input.
    if sys.stdin.isatty():
        return []
    data = sys.stdin.read()
    if not data.strip():
        return []
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return []
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path")
    return [file_path] if file_path else []


def _within_repo(path_str: str) -> bool:
    """Whether [path_str] resolves to a file inside this repo.

    The write hook fires on every edit, including edits to files OUTSIDE this
    repo (for example a config or notes file in the user's home directory). Such
    external files may legitimately contain British words inside their own
    spelling reference tables, so policing them here is both out of scope and a
    guaranteed false-positive source. Restricting to repo paths keeps the gate
    fully active for repo files while leaving external edits alone. Git
    pre-commit only ever passes repo paths, so it is unaffected.
    """
    try:
        resolved = Path(path_str).resolve()
    except OSError:
        return False
    try:
        resolved.relative_to(_REPO_ROOT)
    except ValueError:
        return False
    # Skip vendored / generated trees and non-text files.
    if any(part in _SKIP_DIR_PARTS for part in resolved.parts):
        return False
    return resolved.suffix.lower() in _TEXT_SUFFIXES


def _scan_file(path_str: str) -> list[SpellingHit]:
    """Return every British-spelling hit in one file, one per match."""
    path = Path(path_str)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        # Unreadable or non-UTF-8 file: nothing to police, never block on it.
        return []
    rel = path.resolve().relative_to(_REPO_ROOT).as_posix()
    hits: list[SpellingHit] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        for match in _PATTERN.finditer(line):
            uk = match.group(1).lower()
            hits.append(SpellingHit(rel, line_number, match.group(1), _UK_TO_US[uk]))
    return hits


def _format_hits(hits: list[SpellingHit]) -> str:
    """Render hits as one ``path:line  uk -> us`` line each for stderr."""
    return "\n".join(
        f"  {hit.file}:{hit.line_number}  {hit.uk_word} -> {hit.us_word}"
        for hit in hits
    )


def main() -> int:
    # argv wins (git hook); fall back to a stdin payload (editor write hook).
    paths = list(sys.argv[1:]) or _paths_from_stdin()
    paths = [p for p in paths if _within_repo(p)]
    if not paths:
        return 0

    hits: list[SpellingHit] = []
    for path in paths:
        hits.extend(_scan_file(path))
    if not hits:
        return 0

    sys.stderr.write(
        "British English spelling(s) found - American English is a hard rule "
        "for this repo:\n"
        + _format_hits(hits)
        + "\n\nFix the spelling(s) above before committing. This gate is "
        "intentionally non-bypassable; do not add an ignore path.\n"
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

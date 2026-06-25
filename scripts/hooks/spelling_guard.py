#!/usr/bin/env python3
"""American-English spelling guard for Claude edits and git pre-commit.

Scans touched repo files for British spellings and exits non-zero with the
hits on stderr when any are found. American English is a hard rule for this
repo (see CLAUDE.md), and a British spelling that reaches the README, the
changelog, or a user-facing string ships to GitHub and the Marketplace.

This guard moves the check to *write* time (Claude Edit/Write/MultiEdit, via a
PostToolUse hook) and *commit* time (git pre-commit), where it is early and
non-interactive.

Unlike the larger Saropa toolchains, this extension is one self-contained
package with no scripts/modules split, so the British->American word map lives
inline here rather than in a shared scanner module.

Two invocation modes, one script:
  * git pre-commit  passes staged file paths as command-line arguments.
  * Claude PostToolUse passes a JSON payload on stdin; the edited file is read
    from tool_input.file_path.

Exit codes: 0 = clean, 2 = British spelling(s) found. Exit 2 is meaningful to
Claude Code (stderr is fed back to the model) and is a plain non-zero failure
that blocks the git commit.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# The repo root is two levels up: scripts/hooks/spelling_guard.py. Deriving it
# from __file__ (not cwd) keeps the path math correct no matter where git or
# the editor launches the hook from.
_REPO_ROOT = Path(__file__).resolve().parents[2]

# British -> American spellings. Keys are lower-case whole words; matching is
# case-insensitive and preserves nothing (we only report, the author fixes).
# This mirrors the banned list in the global CLAUDE.md so the gate and the
# rule never drift. Add to this map rather than spawning a second checker.
_UK_TO_US: dict[str, str] = {
    "colour": "color",
    "coloured": "colored",
    "colouring": "coloring",
    "colourful": "colorful",
    "favourite": "favorite",
    "favourites": "favorites",
    "favourited": "favorited",
    "behaviour": "behavior",
    "behaviours": "behaviors",
    "behavioural": "behavioral",
    "centre": "center",
    "centred": "centered",
    "centring": "centering",
    "grey": "gray",
    "greyed": "grayed",
    "greyscale": "grayscale",
    "organise": "organize",
    "organised": "organized",
    "organisation": "organization",
    "optimise": "optimize",
    "optimised": "optimized",
    "optimisation": "optimization",
    "realise": "realize",
    "recognise": "recognize",
    "customise": "customize",
    "prioritise": "prioritize",
    "summarise": "summarize",
    "analyse": "analyze",
    "capitalise": "capitalize",
    "finalise": "finalize",
    "initialise": "initialize",
    "normalise": "normalize",
    "serialise": "serialize",
    "utilise": "utilize",
    "cancelled": "canceled",
    "cancelling": "canceling",
    "labelled": "labeled",
    "labelling": "labeling",
    "modelled": "modeled",
    "modelling": "modeling",
    "travelled": "traveled",
    "travelling": "traveling",
    "defence": "defense",
    "offence": "offense",
    "licence": "license",
    "catalogue": "catalog",
    "dialogue": "dialog",
    "analogue": "analog",
    "programme": "program",
    "whilst": "while",
    "amongst": "among",
    "learnt": "learned",
    "spelt": "spelled",
    "burnt": "burned",
    "leapt": "leaped",
    "kerb": "curb",
    "tyre": "tire",
    "storey": "story",
}

# Compiled once: a single alternation with word boundaries so "centre" matches
# but "centred" (its own key) and substrings inside identifiers do not produce
# false hits on word-internal fragments.
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
    """Pull the edited file path out of a Claude Code PostToolUse payload.

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

    The PostToolUse hook fires on every Edit/Write, including edits to files
    OUTSIDE this repo (e.g. the user's global ~/.claude/CLAUDE.md). That global
    config legitimately contains British words inside its own banned-spelling
    reference table, so policing it here is both out of scope and a guaranteed
    false-positive source. Restricting to repo paths keeps the gate fully active
    for repo files while leaving external edits alone. Git pre-commit only ever
    passes repo paths, so it is unaffected.
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
    # argv wins (git hook); fall back to a stdin payload (Claude hook).
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

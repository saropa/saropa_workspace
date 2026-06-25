#!/usr/bin/env python3
"""Block manual edits to the generated extension README and CHANGELOG.

extension/README.md and extension/CHANGELOG.md are NOT authored files: they are
generated copies of the repo-root README.md / CHANGELOG.md, written by
scripts/publish.py (sync_extension_docs) before every package step. Editing a
copy directly creates drift that the next publish silently overwrites and splits
one source of truth across two files. The root pair is the only place to edit.

This PreToolUse hook denies any Edit / Write / MultiEdit whose target resolves to
one of the two generated files and points the author at the root source. Exit 2
blocks the tool call; any other path, a non-edit tool, or a malformed payload
exits 0 so unrelated edits are never blocked.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Repo root is two levels up: scripts/hooks/generated_docs_guard.py. Derived from
# __file__ (not cwd) so the path math holds wherever the hook is launched from.
_REPO_ROOT = Path(__file__).resolve().parents[2]

# The two generated copies. The authored source is the repo-root file of the
# same name; these are produced by scripts/publish.py and are git-ignored.
_GENERATED = {
    (_REPO_ROOT / "extension" / "README.md").resolve(),
    (_REPO_ROOT / "extension" / "CHANGELOG.md").resolve(),
}


def main() -> int:
    # isatty guards against blocking when the script is run by hand with no
    # piped payload; an empty or non-JSON payload is treated as "not ours".
    if sys.stdin.isatty():
        return 0
    data = sys.stdin.read()
    if not data.strip():
        return 0
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return 0

    file_path = (payload.get("tool_input") or {}).get("file_path")
    if not file_path:
        return 0
    try:
        target = Path(file_path).resolve()
    except OSError:
        return 0
    if target not in _GENERATED:
        return 0

    name = target.name
    sys.stderr.write(
        f"Refusing to edit extension/{name}: it is a generated copy of the "
        f"repo-root {name}, rewritten by scripts/publish.py at package time. "
        f"Edit the root {name} instead; the extension copy is produced on "
        f"publish. This guard is intentional; do not bypass it.\n"
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""UI style-guide reminder for editor edits to user-facing surfaces.

When an Edit/Write/MultiEdit lands on a file that defines a user-facing
surface — a webview panel, a command/menu title, a toast or QuickPick, or a
string catalog — this hook injects a short reminder pointing at the style guide
(plans/guides/STYLEGUIDE.md). It is a *reminder*, never a blocker: it returns
context so the assistant consults and maintains the guide around UI work, and it
exits cleanly on anything it does not recognize so it can never stall an edit.

Two events, one script:
  * PreToolUse   fires before the edit  -> remind to check the guide first.
  * PostToolUse  fires after the edit   -> remind to verify against the guide and
                                           to add a rule if the change set a new
                                           pattern.

The event is read from the payload's hook_event_name. The edited path is read
from tool_input.file_path. Output is the Claude Code hook JSON envelope with
hookSpecificOutput.additionalContext; the assistant receives that text.

Exit code is always 0. A style reminder must never block a write.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Repo root is two levels up: scripts/hooks/styleguide_guard.py. Derived from
# __file__ (not cwd) so the path math holds wherever the editor launches the hook.
_REPO_ROOT = Path(__file__).resolve().parents[2]

# Path fragments (posix form) that mark a file as a user-facing surface. views/
# holds the webview panels; commands/ is where toasts, QuickPicks, and input
# boxes live; i18n/locales is the runtime string catalog; package.nls.json is the
# manifest string catalog. A match on any of these is what arms the reminder.
_UI_FRAGMENTS = (
    "extension/src/views/",
    "extension/src/commands/",
    "extension/src/i18n/locales/",
    "extension/package.nls.json",
)

_GUIDE = "plans/guides/STYLEGUIDE.md"

_PRE_MESSAGE = (
    f"This edit touches a user-facing surface. Before changing it, check "
    f"{_GUIDE}: new screens carry the 'Saropa ' title prefix; every visible "
    f"string is externalized (l10n / package.nls.json); actions emit feedback "
    f"that names the item acted on; voice is second/third person; American "
    f"English. If the request would break a rule, say so and reconcile it before "
    f"writing. If no rule covers the case, decide the convention and add it."
)

_POST_MESSAGE = (
    f"A user-facing surface was edited. Verify it against {_GUIDE}: Saropa "
    f"screen-title prefix, externalized strings, visible feedback naming the "
    f"item, voice, American English. If this change established a NEW pattern or "
    f"convention not yet in the guide, add the rule to {_GUIDE} in this same "
    f"change so the guide does not lag the code."
)


def _payload() -> dict:
    """Parse the hook payload from stdin; empty dict when absent or malformed."""
    # isatty guards against blocking when the script is run by hand with no pipe.
    if sys.stdin.isatty():
        return {}
    data = sys.stdin.read()
    if not data.strip():
        return {}
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _is_ui_surface(file_path: str) -> bool:
    """Whether [file_path] is one of the user-facing surface files in this repo."""
    try:
        resolved = Path(file_path).resolve()
    except OSError:
        return False
    # Restrict to this repo so an edit to an unrelated file elsewhere is ignored.
    try:
        resolved.relative_to(_REPO_ROOT)
    except ValueError:
        return False
    posix = resolved.as_posix()
    return any(fragment in posix for fragment in _UI_FRAGMENTS)


def main() -> int:
    payload = _payload()
    file_path = (payload.get("tool_input") or {}).get("file_path")
    if not file_path or not _is_ui_surface(file_path):
        return 0

    event = payload.get("hook_event_name", "PostToolUse")
    message = _PRE_MESSAGE if event == "PreToolUse" else _POST_MESSAGE

    # The additionalContext envelope is how a non-blocking hook hands text back to
    # the assistant for the matched event.
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": message,
        }
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

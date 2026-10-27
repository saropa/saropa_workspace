# Release Board: items left after the 2.2.0 upgrade

Status 2026-10-27. Everything else for this upgrade is merged. These are the open items.

## Needs a person
- Check the board in one real VS Code window: theme contrast, real git status, quick picks, confirm dialogs.
- Check Cursor's chat command names in `extension/src/board/handAgent.ts`. They are the least certain part of Hand to chat.
- Report on "Hand to chat opens a new Claude Code": the button path only copies; ask for the installed version if it persists.
- Delete the merged remote branches: `bugs/20261027_remote_branch_cleanup.md`. Add `release-board-severity-edit`, `release-board-keyword-editor`, `release-board-open-beside`, `release-board-startup-checkbox`.
- Turn on "Automatically delete head branches" in each repo.

## Code, not started
- Plan item 1.2 audit (`scripts/audit.py`) fails: the pins view title bar has 4 navigation slots because the Release Board button is `navigation@9` (`extension/package.json`). Either move it to the overflow menu or raise the limit to 4 and update `plans/MASTER_PLAN.md`. The publish audit is not affected.
- Keyword editor: no Command Palette command (opens from the board only); `minBodyDensity` and the audience words are kept but not editable; no test drives `BoardPanel`'s `keywords` and `keywordsRestore` messages.
- Open beside: the board's group is taken from the panel's own column. If the board is dragged into a floating window the column may not match (not verified). Locating it through the board's tab would be sturdier.
- Dashboard test "activating the processes tab samples and then sends the data" fails intermittently on main.
- `BoardConfig.severity` type still requires all four weight keys although partial weights work.

## Deferred by the owner
- Phone access: `plans/deferred/20261027_board_phone_access_design.md`.

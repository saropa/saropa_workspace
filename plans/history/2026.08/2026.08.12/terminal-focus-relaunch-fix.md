# Terminal focus prevents accidental relaunch on Enter

Launching a script left keyboard focus in the pins tree view instead of the newly created terminal. If the user pressed Enter immediately after launch — before manually refocusing — VS Code re-activated the selected tree item and re-triggered the same shortcut, appearing as an unwanted relaunch.

## Root cause

`runInTerminal()` in [extension/src/exec/terminalRunner.ts](../../../extension/src/exec/terminalRunner.ts) called `terminal.show(true)`. The `true` argument is VS Code's `preserveFocus` flag: it reveals the terminal panel but leaves editor/tree focus untouched. With focus still on the tree, an Enter keystroke re-invoked the currently selected pin's run command via the tree view's Enter-to-activate binding.

## Fix

Changed the call to `terminal.show(false)`, so focus moves into the terminal immediately after the command is sent. A subsequent Enter is delivered to the terminal (harmless — an empty line, or interacts with a running interactive prompt as expected) instead of back to the tree view.

## Scope note

`runInTerminal` is not exercised by the existing `node --test` suite ([extension/src/test/terminalRunner.test.ts](../../../extension/src/test/terminalRunner.test.ts)) — it depends on `vscode.window.createTerminal`, which the host-independent stub does not model. Only `getOutputChannel` (a sibling export in the same file) is covered. Verification for this change is manual: launch a pin and confirm the terminal has keyboard focus immediately after launch.

## Files changed (1.6.11)

- `extension/src/exec/terminalRunner.ts` — `terminal.show(true)` → `terminal.show(false)`, with a comment explaining why.
- `CHANGELOG.md` — added `[1.6.11]` entry under Fixed.
- `extension/package.json` — version bump to `1.6.11`.

## Follow-up (1.6.12) — second call site and a defense-in-depth backstop

A follow-up audit (grep for `.show(true)` across `extension/src`) found one more terminal call site with the identical `preserveFocus: true` pattern: `actionRunner.ts`'s macro shell-step runner, which reuses `createNamedTerminal` directly for a macro's `shell` step. Fixed identically (`shellTerminal.show(false)`). Other `.show(true)` call sites found by the same grep were confirmed unrelated — they target output channels or panels, not a terminal reachable from the tree's Enter-to-activate path (`backgroundRunner.ts`, `scheduler.ts`, `shortcutExecution.ts`'s "Show Output" choice), or a separate command not reached via the double-click/Enter flow (`recipeCommands.ts`'s `npm run` picker, triggered from a QuickPick selection).

As a second, independent layer, `runShortcutCommand` (`commands/shortcutExecution.ts`) now drops a repeat invocation of the *same* shortcut id arriving within 500ms of the first (`isRepeatInvocation`), before any file/terminal/action work starts. This is deliberately silent — no toast, no state change — reasoned as suppressing noise from the same user gesture rather than a second distinct action; see `STYLEGUIDE.md` §4.1z for the explicit exception this required to the project's no-silent-async rule. A `force` re-run (the "Stop and re-run" / "Run anyway" choices from the already-running dialog) always bypasses the guard.

## Testing (1.6.12)

`isRepeatInvocation` and its window constant are exported and covered by `extension/src/test/shortcutExecution.test.ts` (4 tests: first invocation is never a repeat, a second invocation inside the window is a repeat, the window boundary itself is not a repeat, tracking is per-shortcut-id). The rest of `runShortcutCommand` remains host-dependent and untested under `node --test`, consistent with the rest of this module. Full suite: `npm test` — 1220/1220 passing.

## Files changed (1.6.12)

- `extension/src/exec/actionRunner.ts` — `shellTerminal.show(true)` → `shellTerminal.show(false)` for the macro shell-step terminal.
- `extension/src/commands/shortcutExecution.ts` — added `isRepeatInvocation` / `REPEAT_INVOCATION_GUARD_MS` and wired the guard into `runShortcutCommand`.
- `extension/src/test/shortcutExecution.test.ts` — new test file covering the guard's timing logic.
- `plans/guides/STYLEGUIDE.md` — new §4.1z documenting the no-silent-async exception for a suppressed duplicate invocation.
- `CHANGELOG.md` — added `[1.6.12]` entry under Fixed.
- `extension/package.json` — version bump to `1.6.12`.

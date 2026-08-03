# Notes copy button and launcher stat visibility

The Notes sidebar view lacked a way to copy a note's content to the clipboard without opening it, and the Notes stat chip in the Launcher panel's header bar disappeared when the note count was zero, making the Notes pane toggle unreachable until at least one note existed.

## Changes

### Copy Note Content command

A new `saropaWorkspace.copyNoteContent` command reads the full file via `vscode.workspace.fs.readFile`, converts to UTF-8, and writes it to the system clipboard. It appears as an inline copy icon on each note tree item (before the existing delete icon) and in the right-click context menu. A toast names the copied file; failures are logged to the console and surfaced as a warning toast.

Registrations added:
- Command definition in `package.json` with `$(copy)` icon
- `view/item/context` inline at `@1` and context menu at `1_note@1` (existing delete/rename shifted to `@2`/`@3`)
- Hidden from `commandPalette` (`when: "false"`)
- NLS title `command.copyNoteContent.title` in `package.nls.json`
- Runtime l10n keys `notes.copied` and `notes.copyFailed` in `en.json`

### Always-visible Notes stat

The Launcher panel's `buildHeader` previously used `pushStat()` for every stat, which omits zero-count entries. The Notes stat now bypasses `pushStat` with a direct `stats.push(...)` so the Notes pane toggle chip remains visible even with zero notes. Only the Notes stat has this treatment; all others remain zero-omitted.

## Files touched

- `extension/src/commands/noteCommands.ts` — new `copyNoteContent` handler
- `extension/src/views/launcherViewData.ts` — unconditional Notes stat push
- `extension/package.json` — command, menu, and commandPalette entries
- `extension/package.nls.json` — NLS title
- `extension/src/i18n/locales/en.json` — 2 runtime l10n keys
- `CHANGELOG.md` — `[Unreleased]` entries

## Testing

- Type check clean (`npx tsc --noEmit`)
- Bundle builds (`node esbuild.js`)
- 1120/1122 tests pass; 2 failures are pre-existing from uncommitted launcher menu changes in a prior session, confirmed by stash-and-test

## Finish Report (2026-08-03)

The copy command follows the established note-command pattern (reg + asNoteItem guard + l10n feedback). The catch block logs the underlying error to the console before showing the user-facing warning, ensuring diagnosability without leaking internal paths to the toast. The always-visible stat is an intentional one-off bypass of `pushStat`'s zero-omission rule; if a second stat needs the same treatment, `pushStat` should gain an `alwaysShow` parameter rather than duplicating the bypass.

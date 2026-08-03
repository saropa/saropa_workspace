# Notes copy button and launcher stat visibility

The Notes sidebar view lacked a way to copy a note's content to the clipboard without opening it, and the Notes stat chip in the Launcher panel's header bar disappeared when the note count was zero, making the Notes pane toggle unreachable until at least one note existed.

## Changes

### Copy Note Content command

A new `saropaWorkspace.copyNoteContent` command reads the full file via `vscode.workspace.fs.readFile`, converts to UTF-8, and writes it to the system clipboard. It appears as an inline copy icon on each note tree item (before the existing delete icon) and in the right-click context menu. A toast names the copied file; failures are logged to the console and surfaced as a warning toast.

Guards added during hardening:
- **Size limit (5 MB)**: `vscode.workspace.fs.stat` runs before `readFile`; files over the limit produce a warning toast with the formatted size and do not attempt the read, preventing extension host thread blocking.
- **Binary detection**: a null-byte scan of the first 8 KB rejects non-text content before clipboard write, avoiding garbled paste.

### Copy as Markdown Link command

A new `saropaWorkspace.copyNoteLink` command copies `[filename](relative-path)` to the clipboard, using `vscode.workspace.asRelativePath` when a workspace folder is open and falling back to the bare filename for global notes. Wrapped in try/catch with console error logging and a user-facing warning toast on failure.

### Always-visible Notes stat

The Launcher panel's `buildHeader` previously used `pushStat()` for every stat, which omits zero-count entries. The Notes stat now bypasses `pushStat` with a direct `stats.push(...)` so the Notes pane toggle chip remains visible even with zero notes. Only the Notes stat has this treatment; all others remain zero-omitted.

## Registrations added

- Command definitions in `package.json`: `copyNoteContent` with `$(copy)` icon, `copyNoteLink` with `$(link)` icon
- `view/item/context` inline copy at `@1`, context menu: copy `1_note@1`, link `1_note@2`, rename `1_note@3`, delete `1_note@4`
- Hidden from `commandPalette` (`when: "false"`)
- NLS titles in `package.nls.json`
- Runtime l10n keys: `notes.copied`, `notes.copiedLink`, `notes.copyFailed`, `notes.copyTooLarge`, `notes.copyBinary`

## Files touched

- `extension/src/commands/noteCommands.ts` — `copyNoteContent` with size/binary guards, `copyNoteLink`, `hasBinaryContent` (exported, tested)
- `extension/src/views/launcherViewData.ts` — unconditional Notes stat push
- `extension/package.json` — command, menu, and commandPalette entries
- `extension/package.nls.json` — NLS titles
- `extension/src/i18n/locales/en.json` — 5 runtime l10n keys
- `extension/src/test/noteStore.test.ts` — 3 test cases for `hasBinaryContent`
- `CHANGELOG.md` — `[Unreleased]` entries

## Testing

- Type check clean (`npx tsc --noEmit`)
- Bundle builds (`node esbuild.js`)
- 1125/1125 tests pass, 0 failures
- `formatBytes` reuses the existing implementation from `metricFormat.ts` (tested in `metricFormat.test.ts`)

## Finish Report (2026-08-03)

The copy commands follow the established note-command pattern (reg + asNoteItem guard + l10n feedback + try/catch). The size guard runs `stat` before `readFile` so oversized files never enter memory. The binary heuristic (null-byte in first 8 KB) is documented as a heuristic with a known blind spot past the sample window. `formatBytes` was consolidated from a duplicate into an import from `metricFormat.ts`, satisfying the single-source-of-truth rule. The always-visible stat is an intentional one-off bypass of `pushStat`'s zero-omission rule; if a second stat needs the same treatment, `pushStat` should gain an `alwaysShow` parameter rather than duplicating the bypass.

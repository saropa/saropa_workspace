# Folder-watch alert: Dismiss button

The folder-watch toast for new or changed files offered only Open. The unseen badge could be cleared only by opening the watch, or the alerts silenced only by muting or disabling the whole watch. The toast now has a Dismiss action that marks the files it named as seen and leaves the watch armed.

## Finish Report (2026-11-20)

### Changes

- `exec/folderWatchToast.ts`: `toastFolderDelta` offers Open and Dismiss and resolves `true` only when Dismiss is chosen (Open, closing the toast and the Open-fallback paths resolve `false`).
- `exec/folderWatchEngine.ts`: on a `true` result, calls `store.markSeen` for each added and changed file in that toast. `markSeen` is used instead of `clearUnseen` so files detected by a later scan while the toast was open stay counted.
- `i18n/locales/en.json`: new key `folderWatch.dismiss`.
- `CHANGELOG.md`: `[Unreleased]` entry.
- `test/folderWatchToast.test.ts`: the actions assertion now expects `["Open", "Dismiss"]`; a new test covers Dismiss resolving true with nothing opened, and undefined and Open resolving false.

### Follow-up (same day)

- `FolderWatchStore.markSeenMany` marks a batch of unseen paths in one write and one badge repaint; `markSeen` delegates to it. The engine's Dismiss path uses it instead of one write per file.
- A "Mute 1 hour" toast action sets `FolderWatch.mutedUntil` (epoch ms, `WATCH_MUTE_MS`). The engine still records the baseline and unseen tally while muted and skips only the toast; the mute is read from the store at toast time so one set during a scan is honored. `toastFolderDelta` now resolves `"dismiss" | "mute" | undefined`. The engine confirms a mute with a message naming the watch and the end time.
- Eight British-spelled values in `en.json` changed to the American "color" (keys untouched) to satisfy the repository spelling rule.
- Tests added: store `markSeenMany`, `isWatchMuted`, and engine Dismiss, Mute, muted-suppresses and expired-mute cases.

### Review

- Low-level review of the commit: no findings.
- Test audit: the only test files referencing the changed symbols are `folderWatchToast.test.ts` (updated) and `board/boardSinceLast.test.ts` (its `markSeenNow` is an unrelated board function, unaffected).
- Tests were not executed (machine-safety rule forbids agent test runs). Verified by inspection only.

### Scope notes

- Repo-watch (GitHub issue/PR) toasts are unchanged.
- No other locale catalogs exist in the repo (`en.json` is the only file), so no catalog regeneration or parity gap applies.
- No bug file was closed.

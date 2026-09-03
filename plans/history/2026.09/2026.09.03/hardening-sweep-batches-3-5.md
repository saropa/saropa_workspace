# Hardening sweep — Batches 3–5

Continuation of the 5-batch hardening sweep that addressed 60 actionable items
cataloged from 13 bug-reflection files (BUG-002 through BUG-014). Batches 1–2
landed in a prior session; this session completed Batches 3 (Activation
improvements), 4 (Views hardening), and 5 (Tests + docs).

## Finish Report (2026-09-03)

### Batch 3 — Activation improvements (7 items)

- Extracted `gatedNotice<T>(storage, key, check, show)` helper in
  `activationHelpers.ts` to centralize the check-latch-show pattern used by 5+
  sites. Refactored `maybeOfferFavoritesImport`,
  `maybeNotifyAiContextDefaultChange`, and `seedFolder` to use it.
- `wireWatchers` in `wiringWatchers.ts` now caches `lastConfigDirName` and only
  recreates config-dir watchers (via a `makeDebounced` 150 ms debounce) when the
  resolved directory name actually changed.
- Added single-owner-invariant comment on `createConfigDirWatchers`.
- Moved `runSelectedShortcut` command registration from `wiringStatusBars.ts`
  into `shortcutCommands.ts` (`registerWorkspaceLevelCommands`), threading
  `treeView` through `registerShortcutCommands` → `registerCommandModules` →
  `activate()`.
- Removed redundant trailing `store.rescan()` in `seedEcosystemAutoPins` — each
  folder's config write already triggers a config-listener rescan.
- Documented `configDirWatchers` closure-variable design and
  `createFileSystemWatcher`'s throw behavior.

### Batch 4 — Views hardening (9 items)

- Replaced hand-rolled debounce in `launcherView.ts` with `makeDebounced()`.
- Settings panel `applySetting` now snapshots `previousValue` before the write
  and guards the revert `postMessage` with a `SettingsPanel.current === this`
  disposed check.
- Extracted `ROW_STATE_PRIORITY` and `pickHighestPriorityRowState()` into
  `shortcutRowStatePriority.ts`, consumed by both `computeRowStateBadge` and
  `buildAccessibilityLabel`.
- Added dev-mode `console.warn` in `l10n()` for missing keys, gated on
  `process.env.NODE_ENV !== "production"` (baked in via esbuild `define`).
- Added cross-reference comments for `weekdayShort` keys and HTML-bearing
  `howtoStep1-3` keys.
- Escaped `key` via `CSS.escape()` in `setControlValue`'s `querySelector`.

### Batch 5 — Tests + docs (8 items)

- New test file `webviewClientUtils.test.ts`: verifies `escapeHtmlJs` and
  `formatBytesJs` produce identical output to their host-side equivalents
  (`escapeHtml`, `formatBytes`) across fixture inputs using `new Function`
  compilation. 4 tests.
- New test file `manifestAiContextDefault.test.ts`: reads `package.json` and
  asserts `saropaWorkspace.aiContext.enabled` defaults to `false`. 1 test.
- `buildAccessibilityLabel` test skipped — module imports `vscode.TreeItem` at
  load time, which crashes under `node --test` without a full host stub.
- Fixed two leftover "bombed" references in `shortcut.ts` and
  `configureExpiry.test.ts` missed by BUG-013's earlier sweep.
- Added banned-terms validation check (#6) to `scripts/modules/_audit.py`
  (`_banned_terms_found()`), scoped to `package.nls.json`, `en.json`,
  `README.md`, and `package.json` description.
- Added historical-note header to `PLAN_09_time_bomb_pins.md` pointing to
  BUG-013.
- `CHANGELOG_HISTORY.md` confirmed not bundleable — exists only at repo root,
  never copied to `extension/`.

### Code-review fixes applied post-batch

- `makeDebounced` now returns a `DebouncedFn` type that exposes `.cancel()` in
  addition to the callable signature. `launcherView.ts` `dispose()` calls
  `.cancel()` to drop any pending debounced rescan, restoring the
  cancel-on-dispose invariant that was lost when the hand-rolled timer was
  replaced.
- Fixed comment inaccuracy in `shortcutStoreBase.ts` `toFolderRelative` — the
  claim that `uri` is "always composed by joining onto folder.uri" did not hold
  for the `addShortcut` path, which resolves containment via
  `getWorkspaceFolder` instead.

### Verification

- `npx tsc -p ./ --noEmit` — 0 errors.
- `node esbuild.js` — bundle builds.
- `npm test` — 1242/1242 tests pass.

### Reflection hardening (applied after code review)

- Added `safeFire<T>(emitter, arg, label)` method to `ShortcutStoreBase` —
  wraps `emitter.fire()` in try/catch with a labeled `console.error`. Both
  `onDidRemoveShortcut.fire()` call sites in `shortcutStoreMutationCore.ts` now
  use it instead of duplicated inline try/catch blocks. New emitters get the
  safety guarantee automatically by calling `this.safeFire()`.
- Refactored the three independent cleanup try/catch blocks in `extension.ts`
  `onDidRemoveShortcut` into a `cleanups` array iterated with per-entry
  try/catch — adding a new cleanup is now a one-line diff.
- Made `makeDebounced` return a `DebouncedFn` type that exposes `.cancel()` in
  addition to the callable signature, restoring the cancel-on-dispose invariant
  that `launcherView.ts` lost when its hand-rolled timer was replaced.
- Strengthened the fragility comment on the `gatedNotice` closure-variable
  workaround in `ecosystemAutoPins.ts`.
- Verified esbuild dead-code elimination: production bundle (`--production`)
  strips the `console.warn` from `l10n()` entirely — confirmed by grepping
  `dist/extension.js` for the warning text.
- Confirmed no callers type `makeDebounced` result explicitly as `() => void`,
  so the `DebouncedFn` type change is backward-compatible.

### Known gaps (documented, not fixed)

- `deleteSet()` in `shortcutStoreSets.ts` bypasses `onDidRemoveShortcut`,
  leaking id-keyed cleanup map entries. Documented with LEAK comments.
- `promptMemory`, `runOutputs`, `shortcutBadges`, `lastBrief` id-keyed maps not
  wired to `onDidRemoveShortcut` — only cleared from the explicit "unpin"
  command path.
- `gatedNotice` used for a non-UI check-and-latch role in `seedFolder` via a
  closure-variable workaround. Works correctly but is a design smell — a
  `checkAndLatch<T>` variant without `show` would be cleaner.
- `registerCommandModules` has 5 positional parameters (project rule: prefer
  ≤3). Not fixed to avoid scope creep; a future refactor should bundle into an
  options object.

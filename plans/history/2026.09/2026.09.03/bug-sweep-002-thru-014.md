# Bug sweep: BUG-002 through BUG-014

Thirteen bug reports (BUG-002 through BUG-014, no BUG-001) were filed against the Saropa Workspace VS Code extension v1.6.12, spanning execution, views, packaging, and code-quality concerns. All thirteen were fixed in a single coordinated pass.

## Finish Report (2026-09-03)

### Bugs fixed

| Bug | Area | Summary |
|-----|------|---------|
| BUG-002 | Execution | `runNearestScript` hardcoded `npm` instead of calling `packageManager()` to detect pnpm/yarn/bun |
| BUG-003 | Views | Planner webview had ~64 hardcoded English strings with no STRINGS/l10n bridge |
| BUG-004 | Views | Launcher rescanned all project files on every `onDidSaveTextDocument` event, no debounce |
| BUG-005 | Execution | `toggleFileLock` and `writeSuiteDailyReportFile` used raw `fs.promises` instead of `vscode.workspace.fs` |
| BUG-006 | Packaging | Config-dir `FileSystemWatcher` registered once at activation, never updated on runtime `configDir` change |
| BUG-007 | Views | Settings panel did not revert the displayed value when `cfg.update()` failed |
| BUG-008 | Packaging | Only one keybinding (Alt+P) registered; keyboard-first commands had no defaults |
| BUG-009 | Views | No `accessibilityInformation` on tree items; separator/untapped marker unreadable; Launcher menu lacked ARIA roles |
| BUG-010 | Packaging | Default `autoPins.patterns` and `projectFiles.groups` were Dart/Flutter-specific |
| BUG-011 | Execution | `watchLastRun` and `lastRunAtByShortcutId` Maps never evicted entries on shortcut removal |
| BUG-012 | Views | HTML escaping, CSS design tokens, byte formatting, and glob-to-regex duplicated across multiple files |
| BUG-013 | Packaging | Submenu label "Shortcut Expiry (Time-Bomb)" used inappropriate terminology |
| BUG-014 | Packaging | `aiContext.enabled` defaulted to `true`, scanning chat transcript directories without opt-in |

### Code-review findings addressed

A medium-level code review (8 finder angles) was run against the combined diff (71 files, 833 insertions, 536 deletions). Three confirmed findings were fixed:

1. **Crash path in BUG-002 fix** — `runNearestScript` could crash with a TypeError when no workspace folder was open (undefined `wsFolder.uri` passed to `findNearestPackageJson`). Fixed by guarding `stopAt` and early-returning with the "no script found" warning.

2. **Unbounded `context.subscriptions` growth in BUG-006 fix** — `registerConfigDirWatchers` pushed disposables both to `context.subscriptions` and to a returned array. Repeated `configDir` changes accumulated stale entries. Fixed by using a single wrapper `Disposable` pushed once, delegating to the current batch via `Disposable.from()`.

3. **Hardcoded English fallback strings in BUG-009 fix** — `launcherScriptMenu.ts` had `|| '{name} actions'` and `|| '{name} submenu'` fallbacks duplicating the l10n catalog. Removed the fallbacks; the host injection guarantees the strings.

Two PLAUSIBLE simplification findings were noted but not acted on (deeper refactors beyond this bug sweep):
- The 5-site cleanup triple from BUG-011 should be centralized into `removeShortcut()` or an `onDidRemove` event.
- `buildAccessibilityLabel()` from BUG-009 re-implements the state-priority ladder from `computeRowStateBadge()`.

### Verification

- `npx tsc -p ./ --noEmit` — clean (0 errors)
- `node esbuild.js` — build succeeded
- `npm test` — 1218/1218 tests pass
- Manual smoke tests not performed (no Extension Development Host available)

### Files changed

71 files across `extension/src/`, `extension/package.json`, `extension/package.nls.json`, `extension/src/i18n/locales/en.json`, `CHANGELOG.md`, `docs/FEATURES.md`, and `bugs/*.md`.

### Hardening pass

After the code review, a hardening pass addressed fragility and architectural risks:

- **`onDidRemoveShortcut` event** — added to `ShortcutStoreBase`. `removeShortcut()` now fires the event with the shortcut id, and a single subscriber in `activate()` runs `runStatusRegistry.clear()`, `clearWatchLastRun()`, and `clearLastRunAt()`. The 5-site cleanup triple from BUG-011 was removed; future removal paths automatically get cleanup for free.
- **`Disposable.from()` pattern for config-dir watchers** — `wiringWatchers.ts` now uses a single composite `Disposable` pushed once to `context.subscriptions`, rather than pushing individual watcher disposables on every `configDir` change. Prevents unbounded subscriptions array growth.
- **Hardcoded English fallback strings removed** — `launcherScriptMenu.ts` had `|| '{name} actions'` and `|| '{name} submenu'` fallbacks duplicating the l10n catalog. Removed; the host injection guarantees the strings.
- **Crash guard on `runNearestScript`** — the BUG-002 fix could crash when no workspace folder was open (undefined `wsFolder.uri`). Added an explicit `stopAt` guard with early return.

### New modules created (BUG-012)

- `extension/src/utils/escapeHtml.ts` — canonical host-side HTML escaper
- `extension/src/utils/formatBytes.ts` — canonical byte-size formatter
- `extension/src/views/webviewClientUtils.ts` — JS-source generators for webview client scripts
- `extension/src/views/webviewDesignTokens.ts` — shared CSS design-token `:root` block

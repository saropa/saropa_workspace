# Config path migration: .vscode → .saropa

The project-scoped config file (`saropa-workspace.json`) lived inside `.vscode/`,
a convention inherited from VS Code's own settings folder. This conflated the
extension's data with the editor's, and the path was not brand-specific.

## Finish Report (2026-07-27)

### What changed

The canonical config path moved from `.vscode/saropa-workspace.json` to
`.saropa/saropa-workspace.json`. A `LEGACY_PROJECT_FILE_RELATIVE` constant
preserves the old path for backward compatibility.

### Migration logic (`ensureProjectFile`)

On activation, for each workspace folder:

1. If `.saropa/saropa-workspace.json` already exists → no action.
2. If `.vscode/saropa-workspace.json` exists → read it, rewrite any pin whose
   `path` equals the legacy config path to the new path, write to `.saropa/`,
   delete the legacy file (delete failure is isolated — the migrated copy is
   safe). Log the migration to the output channel.
3. If neither exists → create a fresh empty config at `.saropa/`.

A `readProjectFileBytes` fallback also tries the legacy path when the new one is
absent, as a safety net for partial migrations.

### File watcher

Both `.saropa/` and `.vscode/` locations are watched during the transition
period. Both watchers share a single debounced refresh, so the migration's own
write+delete coalesces into one repaint.

### Suggestion noise filters and sibling import

Both the open-frequency and tab-change suggesters suppress both config paths.
The sibling-project import scanner checks `.saropa/` first, then `.vscode/`.

### Data-loss bug found during review

The original migration catch block spanned read+parse+write+delete. If the
write succeeded but the delete threw (locked file on Windows), the catch fell
through to create an empty config — overwriting the just-migrated data. Fixed
by isolating the delete into its own try/catch so a delete failure leaves the
migrated copy intact.

### Test coverage

- All existing store tests updated: `configPath()` helpers, `mkdirSync` calls,
  assertion strings, and test titles point to `.saropa/`.
- New test: `ensureProjectFile migrates a legacy .vscode/ config to .saropa/
  and rewrites config-path pins` — seeds a legacy file with a config-path pin
  and a normal pin, asserts the new file exists with the rewritten path, the
  normal pin is unchanged, and the legacy file is deleted.

### Docs updated

README, ARCHITECTURE, CONTRIBUTING, SECURITY, ROADMAP, FAQ, FEATURES, PRIVACY,
STYLEGUIDE, BUG_REPORT_GUIDE, and active plan files. Historical changelog
entries and `plans/history/` files left as-is. `.gitignore` updated to cover
both locations.

### Not addressed (flagged by review, out of scope)

- `editConfig.ts` reimplements `ensureExists` instead of delegating to the
  store's `ensureProjectFile`. A race window exists between command registration
  and store init where the command could create an empty `.saropa/` file before
  migration runs. Low probability (requires the user to invoke "Edit Shortcuts
  Config" within milliseconds of window open, before `store.init()` resolves).
- No re-entrancy guard on `refresh()`. The migration's write+delete near-
  certainly triggers a watcher-induced second `refresh()` on first launch after
  upgrade. Pre-existing pattern, newly exercised harder.

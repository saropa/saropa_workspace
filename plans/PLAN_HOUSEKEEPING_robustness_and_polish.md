# Plan — Housekeeping: activation, terminology, dead imports, retention, async scan

Filed from MASTER_PLAN items 2.1 and 3.1–3.5. Each item was re-checked against the tree on 2026-11-20. Nothing here is started.

## H1. Lazy activation (was 2.1)

- **What:** `onStartupFinished` is still in `activationEvents` (`extension/package.json:30`), so every VS Code launch pays activation cost.
- **History:** an earlier pass removed it (see `history/2026.09/2026.09.03/master-plan-p1-p2.md`) and it was later restored as a fallback. The remaining gaps that forced the restore: global-only scheduled shortcuts with no project file, and a non-default `saropaWorkspace.configDir` that the `workspaceContains` globs miss.
- **Fix:** replace the blanket `onStartupFinished` with a lightweight stub that checks globalState for global scheduled shortcuts and a custom `configDir`, and defers full activation only when either exists. Verify the boot sequence, scheduler and branch tracker do not depend on eager activation.
- **Done when:** a window with no shortcuts and no schedules does not activate the extension at startup, and a window with a global schedule still fires it.

## H2. Pin vs shortcut leakage (was 3.1)

- **What:** user-facing "Pin" remains in `extension/src/i18n/locales/en.json:18` (`launcher.pin: "Pin"`, the recipe-card button) and `:140` (`pin.autoEcosystemSeeded`, "auto-pins").
- **Fix:** change both strings to "Shortcut" wording and re-audit the other locale files for the same leak. Command IDs and model types stay (breaking change, deferred to a major version).

## H3. Dead imports (was 3.2)

- **What:** `shortcutStore.ts`, `shortcutStoreBase.ts`, `shortcutStoreRecipes.ts`, `shortcutStoreRefresh.ts` and `shortcutStoreSets.ts` carry import blocks left over from file splits.
- **Fix:** the owner runs `tsc --noEmit` once and lists the TS6133 warnings; remove the unused imports from that list.
## H4. Heartbeat CSV rotation (was 3.3)

- **What:** `extension/src/exec/heartbeat.ts` `appendCsv` appends to `process-trend.csv` forever, and `parseTrendSeries` reads the whole file.
- **Fix:** trim to the last 90 days on a rotation pass (on append when the file passes a size or age threshold). Add a unit test for the trim boundary.

## H5. Report retention (was 3.4)

- **What:** `runShellToReport` writes dated Markdown reports into `reports/` with no cleanup.
- **Fix:** a pruning pass at startup keeping the last N reports per shortcut or the last 30 days. Surface the count removed in a named toast or output line (no silent file deletion). Needs an owner decision on N and the age cutoff before building.

## H6. Async Python install scan (was 3.5)

- **What:** `extension/src/exec/interpreterDetect.ts` `scanPythonInstalls` uses `readdirSync`/`statSync` on `C:\` on the extension host thread.
- **Fix:** convert to `fs/promises`, keeping the same result order. Check the callers handle the promise. Only other sync `fs` use in `src` is `board/nodeSource.ts` (out of scope here).

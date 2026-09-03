# BUG-001: Activation crash on corrupt legacy config during migration

**Status: Closed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Packaging
File(s): `extension/src/model/shortcutStoreBase.ts` (`ensureProjectFile`)
Severity: Critical
Extension version: 1.6.12

---

## Summary

`shortcutStoreBase.ts` `ensureProjectFile` calls `JSON.parse` on legacy `.vscode/saropa-workspace.json` content during the migration path without a try/catch wrapper. If the legacy file contains corrupt or malformed JSON, the unhandled parse error propagates up through activation, potentially preventing the entire extension from loading. Every other `JSON.parse` site in the codebase is defensively wrapped; this one is not.

---

## Attribution Evidence

The migration logic lives in `extension/src/model/shortcutStoreBase.ts`, in the `ensureProjectFile` method. This is internal extension code invoked during activation — not a user script or VS Code core behavior.

---

## Reproducer

1. Create a workspace with a `.vscode/saropa-workspace.json` file containing malformed JSON (e.g. `{invalid`).
2. Install or reload the extension so the activation path hits the legacy migration branch.
3. Observe: `JSON.parse` throws a `SyntaxError`; activation fails.

**Frequency:** Always, when a corrupt legacy config file exists.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | The extension handles corrupt legacy JSON gracefully — logs a warning, skips or recreates the config, and continues activation. |
| **Actual** | Unhandled `SyntaxError` from `JSON.parse` propagates, crashing the activation path. |

---

## State / Flow Context

```
activate (extension.ts)
  └─ ensureProjectFile (model/shortcutStoreBase.ts)
      └─ JSON.parse(legacyContent)   ← unguarded throw on corrupt input
```

---

## Root Cause

The legacy migration branch in `ensureProjectFile` reads the old config file and passes its content directly to `JSON.parse` without a try/catch. Every other JSON parse call in the codebase uses defensive wrapping, but this migration path was missed — it was written assuming the legacy file would always be valid JSON.

---

## Suggested Fix

Wrap the `JSON.parse` call in `ensureProjectFile`'s legacy migration branch in a try/catch. On parse failure:
- Log a warning with the file path and error message.
- Skip the migration (do not carry forward corrupt data).
- Proceed with a fresh/default config so the extension still activates.

This matches the defensive pattern already used at every other JSON parse site in the codebase.

---

## Changes Made

### File 1: `extension/src/model/shortcutStoreBase.ts` (`ensureProjectFile`, ~line 287)

**Before:**
```ts
// Migrate: rewrite any pins whose path targeted a known legacy config
// location so the seed shortcut stays accurate.
const parsed = JSON.parse(Buffer.from(legacyBytes).toString("utf8"));
if (Array.isArray(parsed.pins)) {
```

**After:**
```ts
// Migrate: rewrite any pins whose path targeted a known legacy config
// location so the seed shortcut stays accurate. A corrupt legacy file
// must not crash activation (BUG-001) — treat it like "no legacy file
// here" and keep checking the remaining known locations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches
// the implicit `any` every other JSON.parse site in this file uses.
let parsed: any;
try {
  parsed = JSON.parse(Buffer.from(legacyBytes).toString("utf8"));
} catch (err) {
  getOutputChannel().appendLine(
    `[config] ${legacyRelative} is not valid JSON, skipping migration for ${
      folder.name
    }: ${err instanceof Error ? err.message : String(err)}`
  );
  continue;
}
if (Array.isArray(parsed.pins)) {
```

A corrupt legacy file is skipped the same way a missing one already was
(the loop's existing `catch { continue; }` on `readFile`), so the loop moves
on to the next `KNOWN_CONFIG_DIRS` entry and, if none match, falls through to
creating a fresh empty config — activation always completes.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `npm run build` succeeds
- [x] `npm test` — 1221/1221 pass (no regression; +1 new BUG-001 test)
- [ ] Manual smoke test in the Extension Development Host — **not run**. Place `{invalid` in `.vscode/saropa-workspace.json`, reload the Extension Development Host, confirm activation succeeds and the output channel logs the skip.

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): project (legacy migration)
- Settings Sync enabled (yes / no): n/a

---

## Finish Report (2026-09-03)

**Defect:** `ShortcutStoreBase.ensureProjectFile()` called `JSON.parse` on legacy `.vscode/saropa-workspace.json` content without a try/catch. A corrupt or hand-edited legacy file would throw an unhandled `SyntaxError` during activation, preventing the extension from loading entirely. Every other `JSON.parse` site in `shortcutStoreBase.ts` was already defensively wrapped; this one was an oversight in the migration path added when `.saropa/` became the default config directory.

**Fix:** Wrapped the `JSON.parse` call in a try/catch that logs a diagnostic line to the `Saropa Workspace` output channel (including the folder name and parse error message) and `continue`s to the next `KNOWN_CONFIG_DIRS` entry. This matches the existing `readFile` failure path two lines above, which already catches and continues. The loop falls through to seeding a fresh empty config if no valid legacy file is found — activation always completes.

**Typing choice:** The parsed result uses `let parsed: any` with an eslint-disable comment rather than a narrower type, matching the implicit `any` convention at the sibling `readProjectFile` JSON.parse site in the same file. Introducing a stricter type for this one site would require touching the downstream `parsed.pins` access pattern, expanding the fix scope beyond the bug boundary.

**Test coverage:** Added `shortcutStoreBase.test.ts` test "ensureProjectFile skips a corrupt legacy file without crashing activation (BUG-001)" — writes `{invalid json content` to a `.vscode/saropa-workspace.json`, calls `store.init()`, and asserts: no throw, a fresh config is seeded, and no pins survive from the corrupt file. Suite: 12/12 pass in `shortcutStoreBase.test.cjs`.

**Verification:** `tsc --noEmit` clean. `node esbuild.js` builds. `npm test` 1221/1221 pass (12/12 in the `shortcutStoreBase` suite specifically). Manual Extension Development Host smoke test NOT run (no interactive VS Code window in this environment).

**Companion changes (same commit):** Plan-directory cleanup (12 files archived to `plans/history/2026.09/2026.09.03/`, 3 merged/moved, 1 deleted as duplicate), competitor-analysis consolidation (5 favorites-manager files merged into `plans/competitors/FAVORITES_COMPARISON.md`, git-ignored), stale documentation corrections across README, SECURITY, CONTRIBUTING, and BUG_REPORT_GUIDE (config path `.vscode/` → `.saropa/`, version `0.1.x` → `1.6.x`, removed unshipped feature claims, corrected file-path references to match current module names).

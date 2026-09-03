# BUG-004: Launcher rescans project files on every file save in the workspace

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Tree View / UX
File(s): `extension/src/views/launcherViewData.ts` (`post()`)
Severity: High
Extension version: 1.6.12

---

## Summary

`launcherViewData.ts`'s `post()` method re-scans project files via `listSurfacedFiles()` (which performs disk stat calls) on every `vscode.workspace.onDidSaveTextDocument` event — for every file save anywhere in the workspace, not just saves relevant to surfaced files. This is needless disk-scan work on one of the hottest event paths in VS Code.

---

## Attribution Evidence

The `post()` method and `listSurfacedFiles()` call are in `extension/src/views/launcherViewData.ts`. The `onDidSaveTextDocument` subscription is wired in the same module. All extension code.

---

## Reproducer

1. Open a workspace with many files.
2. Open the Launcher view so it is active.
3. Edit and save any file (e.g. a source file, a README, a config file — anything).
4. Observe: `listSurfacedFiles()` runs on every save, performing disk stat calls across surfaced file paths, regardless of whether the saved file is one of them.

**Frequency:** Every file save while the Launcher view is registered.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | The Launcher only rescans when a save is relevant — when the saved file is a surfaced file, a config file that could change the surfaced set, or when the surfaced file list might have changed. |
| **Actual** | Every save triggers a full rescan via `listSurfacedFiles()`, including saves to files completely unrelated to the Launcher's data. |

---

## State / Flow Context

```
onDidSaveTextDocument (any file in the workspace)
  └─ post() (launcherViewData.ts)
      └─ listSurfacedFiles()   ← disk stat calls on every save
```

---

## Root Cause

The `onDidSaveTextDocument` handler calls `post()` unconditionally. There is no filter checking whether the saved document is relevant to the Launcher's surfaced file set before triggering the rescan. The handler was wired broadly for simplicity but creates unnecessary I/O on a high-frequency event.

---

## Suggested Fix

Add a relevance check before calling `post()`. Options (pick the simplest that covers the case):

1. **Check the saved file's path** against the set of surfaced file paths and config file paths. Only call `post()` if the saved file is in that set.
2. **Debounce** the `post()` call so rapid saves within a short window (e.g. 500ms) coalesce into a single rescan.
3. **Both** — filter by relevance AND debounce as a safety net.

Option 1 alone is the cleanest; option 3 is the most robust.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: save an unrelated file, confirm no disk rescan fires; save a surfaced file, confirm the Launcher updates

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): n/a
- Settings Sync enabled (yes / no): n/a

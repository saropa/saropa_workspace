# BUG-004: Launcher rescans project files on every file save in the workspace

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Tree View / UX
File(s): `extension/src/views/launcherView.ts` (`post()`, `onDidSaveTextDocument` wiring — the original attribution named `launcherViewData.ts`, but `post()` and the save subscription live in `launcherView.ts`; `launcherViewData.ts` only holds the vscode-free `buildAllItems`/`buildHeader` helpers `post()` calls)
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

Applied option 2 (debounce) from the suggested fix, not option 1 (relevance filter) or
option 3 (both). Filtering by relevance was rejected: the surfaced-file set depends on the
user-configurable `saropaWorkspace.projectFiles` glob and on version parsing inside
manifest files, so a narrower filter risks silently missing a save that should trigger a
rescan. A flat debounce is simple, always correct (every relevant save still lands a
rescan, just batched), and caps the worst case to one scan per debounce window.

In `extension/src/views/launcherView.ts`:
- Added a module-level `SAVE_RESCAN_DEBOUNCE_MS = 400` constant and a
  `saveRescanTimer` field on `LauncherViewProvider`.
- `onDidSaveTextDocument` now calls a new `scheduleSaveRescan()` method instead of calling
  `post()` directly; `scheduleSaveRescan()` resets a 400 ms timer on each save and only
  calls `post()` once the timer elapses without another save.
- `dispose()` clears any pending timer so a disposed provider never fires `post()` against
  a webview that no longer exists.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `node esbuild.js` succeeds
- [ ] Manual smoke test: save an unrelated file, confirm no disk rescan fires; save a surfaced file, confirm the Launcher updates (not run — requires an Extension Development Host)

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

---

## Reflection

### Hardening items

- **Redundant back-to-back `post()` calls are still possible.** `scheduleSaveRescan()`
  only debounces the `onDidSaveTextDocument` path; `store.onDidChange`,
  `watchStore.onDidChange`/`onDidChangeCounts`, `noteStore.onDidChange`,
  `onDidChangeWorkspaceFolders`, `onDidChangeConfiguration`, and
  `onDidChangeActiveColorTheme` all still call `post()` directly (`launcherView.ts:73-88`).
  A save that also mutates the store (e.g. saving `.vscode/saropa-workspace.json`) can fire
  an immediate `post()` from `store.onDidChange` and a second one 400ms later from the
  debounce timer — two full `listSurfacedFiles()` scans for one user action.
- **`scheduleSaveRescan()` fires for saves outside the workspace entirely** — an untitled
  buffer, a file opened from outside any workspace folder, a diff-editor virtual document.
  `listSurfacedFiles()` still runs a full rescan even though nothing it surfaces could have
  changed. Accepted per the bug's own rationale (relevance filtering was rejected as
  error-prone), but worth naming as a known-accepted cost rather than an oversight.
- **No automated regression coverage for the debounce.** Per `.claude/rules/test.md`,
  `scheduleSaveRescan()` can't be covered by the `node --test` unit suite because
  `LauncherViewProvider` imports `vscode`. A future edit that widens
  `SAVE_RESCAN_DEBOUNCE_MS`, removes the `dispose()` clear, or reintroduces an unconditional
  `post()` call on the save path would not be caught until manual smoke testing (which was
  itself skipped in this fix's `## Verification` checklist).
- **Timer field is not itself `readonly`/typed as a disposable**, so any future refactor of
  `LauncherViewProvider` that adds another code path calling `this.saveRescanTimer =` (e.g.
  a second debounced trigger) could clobber this one silently — there is no guard preventing
  a second, unrelated timer from reusing the same field.

### Suggestions

- **Reuse `makeDebounced()`** (`extension/src/activation/activationHelpers.ts:75`) instead
  of the hand-rolled `setTimeout`/`clearTimeout` pair in `scheduleSaveRescan()` — it already
  implements the identical trailing-debounce pattern for `ShortcutDecorationProvider`. It
  currently returns only a callable, not a cancel handle, which is likely why it wasn't
  reused here (dispose needs to clear the pending timer). Extending it to return
  `{ run, cancel }` would let both call sites share one implementation instead of two copies
  of the same coalescing logic (violates the "single source of truth" rule in
  `.claude/rules/global.md` as currently written twice).
- **Run the skipped manual smoke test** before closing the bug: open the Extension
  Development Host, save an unrelated file and confirm no immediate rescan network message,
  then save a surfaced file and confirm the Launcher panel updates within ~400ms.

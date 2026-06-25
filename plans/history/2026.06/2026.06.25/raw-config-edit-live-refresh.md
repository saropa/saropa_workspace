# Raw-config editability with live refresh (roadmap Later / Exploratory)

The project pins file (`.vscode/saropa-workspace.json`) could only be changed
through the GUI editors, and an external edit to it was not picked up — the store
held no watcher, so a hand edit required a window reload. This adds a command to
open the raw JSON and a watcher that refreshes the tree live when it is saved.

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript). No Dart/Flutter code touched.

### What changed

- **New module `extension/src/commands/editConfig.ts`** — `editPinsConfig()` opens
  the per-folder `.vscode/saropa-workspace.json` for direct editing. With one
  folder open it uses that folder; with several it prompts which to edit. The file
  is created empty and valid (`emptyProjectPinsFile()`) when absent, so the command
  never dead-ends on "file not found". Opens with `preview: false` (a permanent,
  editable tab).

- **`extension/src/extension.ts`** — a `createFileSystemWatcher` on
  `**/.vscode/saropa-workspace.json` calls a debounced `store.refresh()` on
  change/create/delete, so a hand edit shows in the tree on save without a reload.
  The store's OWN writes also trip the watcher, so the refresh is debounced
  (150ms, via a new local `makeDebounced` helper) to coalesce the write-then-notify
  burst into a single repaint. The watcher and its listeners are disposed via
  `context.subscriptions`.

- **`extension/src/commands/pinCommands.ts`** — registers
  `saropaWorkspace.editPinsConfig`.

- **Manifest / strings:** `package.json` adds the command ($(json) icon) and a
  `2_share@3` entry in the Pins view title menu; `package.nls.json` the title;
  `en.json` the `pinsConfig.*` strings.

- **`CHANGELOG.md`** — Unreleased "Added" entry. **`ROADMAP.md`** — the
  Later/Exploratory "Raw-config editability with live refresh" bullet removed.

### Why it is safe

- No refresh loop: `store.refresh()` re-reads the files and repaints but never
  writes them, so a watcher-triggered refresh cannot re-trigger itself. The
  debounce only collapses redundant events (the store's own write plus the editor
  save) into one repaint.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — the changed files
  (`editConfig.ts`, `extension.ts`, `pinCommands.ts`, manifests) report no errors.
  A single pre-existing error in `configureTriggers.ts` (an unrelated, concurrently
  in-flight feature) is present in the shared tree and was left untouched.
- `node esbuild.js` from `extension/` — bundle builds (esbuild does not type-check,
  so the unrelated error does not affect the shipped bundle).
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by per-file type-cleanliness, bundle build, and
  inspection.

### Notes for maintainers

- The watcher uses a single workspace-wide glob, so a folder added mid-session is
  covered without re-registration.

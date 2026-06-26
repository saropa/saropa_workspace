# Project Files view — file count on the view title

The Project Files tree view surfaced interesting files (README, CHANGELOG,
manifests) but gave no at-a-glance total; a user had to expand the view and count
rows, and in multi-folder workspaces only per-folder counts were shown on folder
nodes. This change publishes the total surfaced-file count and binds it to the
tree view's title description.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript) plus the root changelog. No Dart/Flutter code.

### Change
- `extension/src/views/projectFilesProvider.ts`
  - Added a tracked total count (`_count`) and an `onDidChangeCount` emitter, plus
    a public `count` getter so a late subscriber (the view is created after the
    provider) can paint the initial title.
  - The count is set during the existing root scan from `found.length` — the full
    set across all open folders in both the single-folder (flat) and multi-folder
    (grouped) branches — so no second scan is introduced.
  - `setCount` re-emits only when the value actually changes, so the title does
    not flicker on every repaint.
  - The folder-expand sub-scan (one folder's files) deliberately leaves the
    published total untouched.
  - The not-enabled and no-folders early returns set the count to 0.
- `extension/src/extension.ts`
  - Binds the count to `projectFilesView.description`: a positive count shows the
    number, a zero count clears the description (no "0" on an empty or disabled
    view). Subscribes to `onDidChangeCount` (registered to
    `context.subscriptions`) and paints once from `projectFiles.count` at wire-up.
- `CHANGELOG.md`
  - Entry under `## [Unreleased] → Added`.

### Why a description, not a badge
The activity-bar badge is already used for the Pins view's "untapped pins"
discovery cue (notification-style, attention-seeking). A plain informational total
belongs in the view title description, matching the `String(count)` style already
used on the project-files folder nodes.

### Verification
- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- No unit test added: the provider imports `vscode` (EventEmitter, TreeView) and
  is host-dependent, so it cannot run under the repo's `node --test` harness
  (no `@vscode/test-electron` wiring). No project-files tests exist. The only new
  logic is the one-line change-guard in `setCount`; extracting it solely for a
  unit test would be premature abstraction.

### Live-update triggers (unchanged, reused)
The count repaints on the same events that already refresh the view: file save,
workspace-folder change, and `saropaWorkspace.projectFiles` config change — each
fires `refresh()`, which re-runs the root scan and thus `setCount`.

# Save and restore a named editor layout

Arranging the editor grid a feature needs — one file left, another right, a third in
a split — took several drags every time. This adds named editor layouts: capture the
current text-editor grid under a name, and restore that grid (columns + files) in one
pick.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`commands/layoutPins.ts`** (new):
  - `saveLayout(context)` captures every open text tab (`TabInputText`) and its grid
    column from `vscode.window.tabGroups`, normalizes the columns to a contiguous
    1..N range (so a closed middle group leaves no gap on restore), prompts for a
    name, and stores the snapshot in `globalState` under
    `saropaWorkspace.editorLayouts`. Saving under an existing name overwrites it.
  - `restoreLayout(context)` lists saved layouts in a QuickPick, recreates the grid
    via the `vscode.setEditorLayout` command (horizontal orientation, N groups), then
    reopens each captured document in its column. A document that no longer resolves
    is skipped and counted; the toast reports opened-vs-skipped so a partial restore
    is honest rather than silent.
- **Commands `saropaWorkspace.saveLayout` / `saropaWorkspace.restoreLayout`**
  ("Save Editor Layout..." / "Restore Editor Layout..."): registered in
  `registerPinCommands` (passed the extension context for globalState; no pin/store
  argument). Surfaced in the Pins view title `···` overflow (the `0_new` group with
  the scratchpad action) and in the command palette.

### Design note (commands, not a tree-row pin)
The pitch framed this as a clickable "Layout Pin" in the tree. A layout is not a file
or a runnable action — the existing Pin model is path/action-shaped — so modeling it
as a pin would mean a new action kind threaded through the model, the click
dispatcher, and the tree renderer. The captured value (a named grid the user restores
on demand) is delivered faithfully as a save/restore command pair backed by
globalState; only text editors are captured (diffs / notebooks / webviews have no
single reopenable document and are skipped, reflected in the saved count).

### Verification
`npx tsc -p ./ --noEmit` exit 0; `node esbuild.js` exit 0; all three manifests
parse-validated. No test harness in the extension; verified by type-check, build, and
inspection.

### Localization
`layout.*` runtime strings in `en.json`; `command.saveLayout.title` /
`command.restoreLayout.title` in `package.nls.json`. No MT pipeline in this repo.

# Peek a pinned file in an inline overlay

Clicking a file pin always opened a new editor tab and stole focus, breaking the
flow of glancing at another file (a constant, a type) while editing. This adds a
**Peek** action that renders a pinned file in VS Code's native inline peek overlay
over the active editor, leaving the current tab and focus untouched.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code involved.

### What changed
- **New command `saropaWorkspace.peekPin`** ("Peek"), on the context menu of file
  pins in the Pins and Recipes views (icon `$(eye)`). Gated off the command palette
  (`when: false`) like the other pin-targeted commands, since it needs a pin
  argument.
- **Handler `peekPin` in `commands/pinCommands.ts`.** For a file pin it invokes the
  built-in `editor.action.peekLocations` with the active editor's uri + cursor
  position and the pinned file as the single target location, in `"peek"` mode — an
  inline, non-navigating overlay that does not open a tab or move focus. It marks the
  pin tapped (clearing it from the untapped activity-bar badge), reuses the existing
  missing-file handling (`fileExists` + `handleMissingFile`), and falls back
  sensibly: a non-file recipe pin shows its single-click action info instead, and
  with no active editor to anchor the overlay the file is opened normally.
- **Manifest wiring**: command declaration, `view/item/context` menu entry gated to
  file pins (`viewItem =~ /^pin/ && viewItem != pinRecipe`), palette `when: false`,
  and `command.peekPin.title` in `package.nls.json`.

### Interaction note (design decision)
The original pitch described a middle-click / Alt+Click gesture. The VS Code
TreeView API does not expose the mouse button or modifier keys on item activation,
so that exact gesture is not implementable from a tree item. The action is therefore
delivered as a discoverable context-menu command (and eye icon), which provides the
same payoff — glance without a tab or focus change.

### Why it is correct / safe
The handler is read-only with respect to pins and the workspace; it only opens an
overlay. It reuses the established resolve/missing-file path so a deleted target
offers Unpin/Reveal instead of a raw error, consistent with open and run.

### Verification
- `npx tsc -p ./ --noEmit` → exit 0.
- `node esbuild.js` → bundle built, exit 0.
- No automated tests were run: the extension has no test harness (no `test/`
  directory, no `*.test.ts`, no wired runner). Verified by type-check, build, and
  inspection.

### Localization
No new runtime strings (the missing-file path reuses `pin.missingFile`). One
manifest title added to `package.nls.json`. This repo has no machine-translation
pipeline, so no catalog regeneration applies.

# Missing pinned-file handling

A pinned file deleted or moved on disk left the pin rendering as normal, and
clicking it surfaced VS Code's raw "cannot open file, does not exist" error. This
change detects a vanished target, flags the pin in the tree, and replaces the raw
error with an actionable message that names the pin and offers Unpin / Show in
Folder.

## Finish Report (2026-06-25)

### Defect

`PinStore.resolveUri` only joins paths; it never stats the target. It returns
`undefined` solely when the owning workspace folder cannot be mapped (a multi-root
edge), never when the file itself is gone. Consequently:

- The tree's existing "missing target" branch in `PinTreeItem`
  (`isFile && !resolvedUri` -> warning glyph) never fired for a genuinely deleted
  file. The pin kept rendering with its normal file-type icon.
- A single click (`openPin`) or double click (`runPinCommand`) resolved a URI for
  the absent file and called `showTextDocument` / the runner, producing VS Code's
  raw not-found error. The `pin.missingFile` toast on the `!uri` branch was dead
  code for the deleted-file case.

### Change

Scope: VS Code extension (TypeScript) only.

1. Detection — `extension/src/model/pinStore.ts`. After each `refresh`, a deferred
   `recomputeMissing` pass stats every resolved file pin (project + global,
   excluding recipe/url/shell/command/macro pins, which have no single file) and
   records the absent ones in `missingPinIds`, exposed via `isMissing(id)`. The
   pass runs off the first-paint path (mirrors the recipe-detection pattern), is
   guarded by a monotonic `missingGen` token so a slow stat cannot clobber newer
   state, and fires a repaint only when the set membership actually changed
   (`setsEqual` helper) so a steady-state refresh costs nothing visible. A pin
   whose folder is unresolvable is skipped here, since that distinct state is
   already handled by the tree's `!resolvedUri` branch.

2. Rendering — `extension/src/views/pinTreeItem.ts` and `pinsTreeProvider.ts`. The
   provider passes `store.isMissing(pin.id)` into a new `missing` constructor
   parameter. A missing file pin shows the warning glyph (folded into the existing
   `!resolvedUri` branch, ahead of the last-run badge so a stale green check on a
   gone file cannot win) and a "file not found" tooltip line.

3. Click handling — `extension/src/commands/pinCommands.ts`. Both `openPin` and
   `runPinCommand` re-stat the target at click time (`fileExists`) before acting,
   so a file restored since the last refresh still opens without a stale verdict.
   When absent, `handleMissingFile` shows a warning that names the pin and offers
   Unpin (removes the pin and clears its run badge) or Show in Folder (reveals the
   parent directory via `revealFileInOS`, since revealing a non-existent path is
   unreliable across platforms).

### Policy

The pin is never auto-removed and no filesystem watcher is added. A deletion is
often transient (a git branch switch, a regenerated build artifact), and project
pins are shared through the committed `.vscode/saropa-workspace.json`; silent
removal would be destructive and would churn on every checkout. Removal stays a
deliberate user choice via the Unpin action.

### Verification

- `npx tsc -p ./ --noEmit` (from `extension/`): clean.
- `node esbuild.js` (from `extension/`): bundle builds.
- No automated tests: the extension has no committed test specs. Behavior was
  verified by inspection and type-check.

### l10n

Added runtime keys to `extension/src/i18n/locales/en.json`: `pin.missingTooltip`,
`pin.missing.message`, `pin.missing.unpin`, `pin.missing.reveal`. American English
source; no machine-translation pipeline in this repo.

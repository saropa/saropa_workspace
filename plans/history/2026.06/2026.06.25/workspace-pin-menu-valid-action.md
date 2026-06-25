# Workspace Pin menu — show only the valid action per file

The "Workspace Pin" submenu listed all four actions (Add/Remove to Project,
Add/Remove to Global) unconditionally on every surface, so a file already pinned
still offered "Add" and an unpinned file still offered "Remove". The menu also had
no per-file awareness, so it could not reflect the state of the exact file
right-clicked.

## Finish Report (2026-06-25)

### Defect

The four add/remove submenu items were static. The original design relied on
click-time feedback (a "already pinned" / "not pinned" toast) instead of hiding
the invalid action, on the assumption that a VS Code menu filter cannot test
whether an arbitrary right-clicked file is pinned. That assumption was incorrect.

### Fix

VS Code `when`-clause expressions support the `in` / `not in` operators, which
test membership against a context-key whose value is an object (membership is by
key existence). The fix publishes the set of pinned file paths per scope as two
context-key objects and gates the submenu items against them, so the menu reflects
the exact resource acted on — uniformly across the Explorer, editor body, editor
tab, and the sidebar pin row (the `resourcePath` key is supplied in all four).

Changes:

- `extension/src/extension.ts` — `syncPinnedPathContext(store)` builds two objects
  (`saropaWorkspace.projectPinnedPaths`, `saropaWorkspace.globalPinnedPaths`) whose
  keys are the absolute paths of every file pinned in each scope, and sets them via
  `setContext`. Both `uri.fsPath` (`d:\src\a.ts`) and `uri.path` (`/d:/src/a.ts`)
  are registered for each pin, because the `resourcePath` context key uses one form
  or the other by platform and the `in` test only checks key existence. Non-file
  recipe pins (no on-disk path) are skipped. The sync runs on every
  `store.onDidChange` and once explicitly after `store.init()` (in case the
  init-time event fires before the subscription attaches).
- `extension/package.json` — the four `saropaWorkspace.pinSubmenu` items gate on
  `resourcePath in / not in` the matching scope object, so each scope shows exactly
  one of Add / Remove for the acted-on file.
- `extension/src/commands/pinCommands.ts` — comment updated; the add/remove
  commands keep their click-time validation so a command-palette / keybinding
  invocation (which has no `resourcePath` gating) still behaves correctly.

### Constraint recorded (not fixed)

Tree-view indentation was also raised. The VS Code Tree View API exposes no
per-view or per-`TreeItem` indentation control; the only lever is the global
`workbench.tree.indent` setting (default 8px), which applies to every tree view
including the Explorer and cannot be scoped to one view from an extension. Most of
the visible offset is VS Code's fixed twistie + icon reservation, which that
setting does not shrink. No code change was possible for this item.

### Verification

No automated test suite exists in this repository (`npm test` references compiled
tests with no source files). Verified by `npx tsc -p ./ --noEmit` (clean) and
`node esbuild.js` (clean bundle). Runtime behavior across the four menu surfaces
requires a manual smoke test in the Extension Development Host.

### References

- VS Code when-clause `in` operator and resource context keys:
  https://code.visualstudio.com/api/references/when-clause-contexts
- Tree View API (no per-view indent):
  https://code.visualstudio.com/api/extension-guides/tree-view

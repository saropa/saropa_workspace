# Shortcut context menu — fold overflow into themed submenus

The shortcut tree's right-click menu (`view/item/context` for `viewItem =~ /^shortcut/`)
had grown to roughly 35 flat rows in a single flyout, dominated by a 13-item
configuration block, making it unscannable. The menu is now restructured so the
most-used run actions stay at the top level and the remainder fold into four
labeled submenus, dropping the top level to about 15 rows.

## Finish Report (2026-06-26)

### Scope

VS Code extension manifest only — `extension/package.json` (`contributes.submenus`
and `contributes.menus`) and `extension/package.nls.json` (submenu labels). No
TypeScript runtime code changed. Documentation: root `CHANGELOG.md` and
`plans/guides/STYLEGUIDE.md`. A new manifest-integrity test was added under
`extension/src/test/`.

### Change

Four new submenus were added to `contributes.submenus`, each with an icon and an
externalized label:

- `saropaWorkspace.outputSubmenu` — "Output & Logs" (Peek, Show Output, Toggle Log
  Follow, Diff Last Two Runs, Simulate Run).
- `saropaWorkspace.configureSubmenu` — "Configure & Schedule" (Configure Run,
  Configure Schedule / Schedule Quick, Configure Triggers, Run When a File Changes,
  Pause / Unpause).
- `saropaWorkspace.appearanceSubmenu` — "Appearance & Tags" (Set Icon & Color, Set
  Live Metric, Tag, branch link, the Expiry submenu, Mask / Reveal).
- `saropaWorkspace.fileSubmenu` — "File Actions" (New File Here, Duplicate, Rename
  on Disk, Copy To, Lock / Unlock, Delete).

The corresponding commands were removed from the flat `view/item/context` list and
moved into per-submenu item arrays in `contributes.menus`. The flyout now reads:
run actions (Open, Run, Run with Last Parameters, Stop / Force Kill) → the three
shortcut submenus (Output, Configure, Appearance) → Rename / New Routine / Use as
Template / Workspace Shortcut → File Actions → Copy Path / Copy as Saropa Link →
Add Comment / Add Separator.

### Correctness constraints

- Each moved command retains its original `when` clause verbatim, so per-item-type
  visibility (recipe vs. scheduled vs. auto vs. paused vs. running) is unchanged.
  An empty submenu is auto-hidden by VS Code, so a submenu whose every child is
  gated off (e.g. for a running shortcut) does not appear as an empty row.
- The nested Expiry submenu remains a submenu and is referenced from within the
  Appearance submenu (submenu-in-submenu), preserving its prior items.
- All command/submenu references were verified to resolve against
  `contributes.commands` and `contributes.submenus`.

### Icons clarification

Every command in this menu already carried an `icon` (`$(play)`, `$(gear)`,
`$(trash)`, and so on). VS Code renders a command icon only as an inline
(hover-toolbar) action and on a submenu's `▸` row; it does not render icons on
ordinary `view/item/context` dropdown rows, which are text-only by contribution
design. There is no manifest path to place an icon beside a dropdown label, so the
decluttering was achieved through grouping and submenus rather than per-row icons.
This constraint and the submenu-grouping convention were recorded in
`plans/guides/STYLEGUIDE.md` (section 3, Native-first surfaces).

### Tests

Added `extension/src/test/menuStructure.test.ts` (runs under `node --test`, no
extension host needed): asserts every submenu reference resolves to a declared
submenu, every declared submenu has an items array, every menu command is a
declared command, and the four shortcut submenus exist with resolvable NLS labels
and non-empty item lists. All four assertions pass. `tsc -p ./ --noEmit` is clean.

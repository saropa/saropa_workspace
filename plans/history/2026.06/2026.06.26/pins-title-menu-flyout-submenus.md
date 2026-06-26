# Pins title menu — flyout submenus

The Pins view title overflow menu (`···`) presented roughly thirty commands as a
single flat, divider-separated list, forcing a long scroll to reach lower items.
The menu is now restructured into six native VS Code flyout submenus so each
action sits one hover away inside a labeled group.

## Finish Report (2026-06-26)

### Scope

VS Code extension manifest only:

- `extension/package.json` — `contributes.submenus` and `contributes.menus`.
- `extension/package.nls.json` — six new submenu label strings.
- `CHANGELOG.md` (root) — one Changed entry.

No runtime TypeScript logic changed. No command was added or removed; existing
commands were relocated from `view/title` into submenu menu arrays.

### Defect

The `view/title` contribution for `saropaWorkspace.pins` placed every
non-`navigation` command directly in the overflow menu. VS Code renders that as
one flat list grouped only by dividers. The author's four divider groups had
grown to about thirty items, and two of the groups were grab-bags (the first
mixed "New Group" with "Save Editor Layout", "Focus on Pinned Files", and
"Switch .env Profile"), so the list neither fit on screen nor read as cohesive.

### Change

Six `submenus` entries were declared, each referenced once in the pins
`view/title` under a shared `1_menu@1..6` group so they cluster as flyouts after
the inline `navigation` icons. Every overflow command moved into the matching
submenu's menu array, regrouped by function rather than by the prior divider
layout:

- **Add to Pins** (`$(add)`) — New Group, Pin External File; Add Comment, Add
  Separator. Every item inserts a row into the Pins view, so the label names the
  destination rather than the bare verb "Add".
- **Editor Layout & Focus** (`$(editor-layout)`) — New Scratchpad; Save / Restore
  Editor Layout; Focus on Pinned Files (the focus/exit pair retains its
  `focusActive` `when` discriminator so exactly one shows). New Scratchpad opens
  an editor buffer rather than adding a Pins row, so it lives with the other
  editor-window actions and sorts first.
- **Import & Suggest** (`$(cloud-download)`) — Suggest Pins from Shell History;
  Import Favorites, Scan Sibling Projects; Import / Export Pins, Edit Pins Config.
- **Pin Sets** (`$(layers)`) — switch, new, rename, duplicate, delete; link /
  unlink current branch.
- **Run & Diagnostics** (`$(pulse)`) — Show Output, View Run Analytics, Reset Run
  History; New Hygiene Scan.
- **Workspace & Schedule** (`$(gear)`) — Switch .env Profile, Configure Boot
  Sequence, Open Schedule & Workflow Planner; Restore Auto-Pins.

The inline title-bar icons (filter, tag pick, run, refresh, branch filter) stay
in the `navigation` group and are unchanged, as are the `recipes` and
`projectFiles` title entries.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `package.json` and `package.nls.json` re-parsed as valid JSON.
- `python scripts/publish.py --mode audit` — clean: all `%keys%` resolve in
  `package.nls.json` (including the six new `submenu.*.label` keys), no empty
  changelog sections, no manifest parity failures.

No manifest-menu unit test exists; the publish audit is the structural validator
for `view/title` / submenu command-and-key parity and was the verification used.

### Label refinement (resolved)

The create flyout first shipped as "Add...". The bare verb did not say what it
added, and the trailing ellipsis is a VS Code convention reserved for commands
that open further input, which a submenu does not. It was renamed to "Add to
Pins" — naming the destination — and New Scratchpad, which adds nothing to the
tree, was moved to the Editor Layout & Focus flyout. No ellipsis remains on any
submenu label.

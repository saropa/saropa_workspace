# Context menu logical grouping

The shortcut right-click context menu in the Saropa Launcher tab had a `3_edit`
group that lumped together pin identity actions (Rename, Pin Scope) with creation
actions (Promote Recipe, New Routine from Selection, Use as Template). These are
conceptually distinct operations — one set modifies the pin itself, the other
spawns new items from it.

## Finish Report (2026-07-27)

### Change

Split `3_edit` into two groups with a separator between them:

- `3_manage` — Rename Pin, Pin Scope submenu (identity and scope management)
- `4_create` — Promote Recipe, New Routine from Selection, Use as Template (creating new items from the current pin)

Downstream groups renumbered: File → `5_file`, Copy → `6_copy`, Annotate → `7_annotate`.

No `when` clauses or command registrations were changed — only the `group` field
values in `view/item/context` entries within `extension/package.json`.

### Before → After menu layout

| Group | Before | After |
|---|---|---|
| 1_run | Open, Run, Stop | (unchanged) |
| 2_menu | Output ▸, Configure ▸, Appearance ▸ | (unchanged) |
| 3_edit | Rename, Promote, Routine, Template, Pin Scope ▸ | — |
| 3_manage | — | Rename, Pin Scope ▸ |
| 4_create | — | Promote, Routine, Template |
| 4_file → 5_file | File ▸ | File ▸ |
| 5_copy → 6_copy | Copy Path, Copy Link | Copy Path, Copy Link |
| 6_annotate → 7_annotate | Comment, Separator | Comment, Separator |

### Recipe view coverage

Recipe items (`shortcutRecipe*`) see a subset of groups because `when` clauses
restrict several entries to `view == saropaWorkspace.pins` only:

- **5_file** (File submenu) — pins only. Recipes are not file-backed in the same way.
- **7_annotate** (Comment, Separator) — pins only. Recipes cannot be annotated.
- **3_manage@2** (Pin Scope) — pins only (excludes `shortcutRecipe` viewItems).
- **4_create@3** (Use as Template) — pins only.

An empty group is auto-hidden by VS Code, so recipes show a clean menu without
blank separators.

### Ordering guarantee

VS Code sorts `view/item/context` groups in lexicographic order of the `group`
string prefix (`3_manage` before `4_create`). Items within a group sort by the
`@n` suffix. All `@n` values within each group are unique — verified, no
collisions.

### Documentation

The group numbering scheme and per-group semantic purpose are documented in
`plans/guides/STYLEGUIDE.md` (section 3, context-menu rules) with a table showing
which groups appear for pins vs recipes. Future contributors add items to the
group that matches semantically rather than appending to the nearest one.

### Risk

None. Declarative JSON only — no runtime code changed. Visual-only impact.

### Verification

Type-check clean (`npx tsc --noEmit`). No unit tests cover menu group
assignments. Requires visual verification in the Extension Development Host.

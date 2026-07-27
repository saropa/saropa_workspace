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

### Risk

None. Declarative JSON only — no runtime code changed. Visual-only impact.

### Verification

Type-check clean (`npx tsc --noEmit`). No unit tests cover menu group
assignments. Requires visual verification in the Extension Development Host.

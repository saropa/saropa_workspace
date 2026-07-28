# Context menu submenu consolidation

The shortcut right-click context menu in the Saropa Launcher tab displayed up to
20 flat items, overflowing the window. Submenus were defined in `package.json`
(Output & Logs, Configure & Schedule, Appearance & Tags, File Actions) but the
remaining items — Rename, Copy Path, Copy Link, New Routine, Use as Template,
Promote Recipe, Add Comment, Add Separator, Re-run Last Params — sat at the top
level, making the menu too long to scan or fit on screen.

## Finish Report (2026-07-27)

### Change

Created a new **Manage & Create** submenu (`saropaWorkspace.organizeSubmenu`) to
absorb the remaining flat items:

| Item | Previous location | New location |
|---|---|---|
| Rename Pin | `view/item/context` group `3_manage@1` | `organizeSubmenu` group `1_manage@1` |
| Promote Recipe | `view/item/context` group `4_create@1` | `organizeSubmenu` group `1_manage@2` |
| New Routine from Selection | `view/item/context` group `4_create@2` | `organizeSubmenu` group `2_create@1` |
| Use as Template | `view/item/context` group `4_create@3` | `organizeSubmenu` group `2_create@2` |
| Copy Path | `view/item/context` group `6_copy@1` | `organizeSubmenu` group `3_copy@1` |
| Copy Pin Link | `view/item/context` group `6_copy@2` | `organizeSubmenu` group `3_copy@2` |
| Add Comment | `view/item/context` group `7_annotate@1` | `organizeSubmenu` group `4_annotate@1` |
| Add Separator | `view/item/context` group `7_annotate@2` | `organizeSubmenu` group `4_annotate@2` |
| Re-run Last Params | `view/item/context` group `1_run@3` | `configureSubmenu` group `1_run@5` |

All `when` clauses preserved verbatim — per-viewItem visibility is unchanged.

### Resulting top-level menu (normal shortcut)

```
Open
Run
───────────────────
Output & Logs        ▸
Configure & Schedule ▸   (now includes Re-run Last Params)
Appearance & Tags    ▸
───────────────────
Workspace Shortcut   ▸   (pin scope)
File Actions         ▸
Manage & Create      ▸   (rename, copy, create, annotate)
```

10 items + 2 separators — down from ~20 items + 6 separators.

### Files changed

- `extension/package.json` — new submenu definition, new submenu contents,
  moved `runPinLastParams` into `configureSubmenu`, replaced flat
  `view/item/context` entries with submenu references.
- `extension/package.nls.json` — added `submenu.organize.label`.
- `CHANGELOG.md` — updated [Unreleased] Changed entry.
- `plans/guides/STYLEGUIDE.md` — updated group table to match new 3-group
  top-level structure.

### Risk

Low. Declarative JSON only — no runtime TypeScript changed. The `organizeSubmenu`
has a broad `when` clause (`viewItem =~ /^shortcut/`) so it appears for all
shortcut types; individual items inside gate on their own `when` for per-type
visibility. An empty submenu is auto-hidden by VS Code.

### Verification

Type-check clean. Build clean. Requires visual verification in the Extension
Development Host (F5).

### Open question

The user's screenshots showed the existing submenus (Output, Configure,
Appearance, File) rendering flat — their contents appeared at the top level with
no submenu arrows. The root cause was not identified. Possible explanations: the
user was running the installed marketplace extension (which predates the submenu
additions) rather than the dev host, or a stale build artifact was loaded. The
new `organizeSubmenu` follows the same wiring pattern as the existing submenus,
so if the existing ones don't render, this one won't either. The user needs to
test in the Extension Development Host (F5) after a fresh build to verify.

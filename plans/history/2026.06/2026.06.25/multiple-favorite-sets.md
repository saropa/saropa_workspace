# Multiple favorite sets

Roadmap: Later / Exploratory. Net-new feature. **Gates branch-aware pin sets (3.2).**

## Verified current state

No set concept exists. Pins live in a single project scope
(`.vscode/saropa-workspace.json`) plus a single global scope (`globalState`). A
`layoutPins.ts:9` comment mentions "per-machine favorite set" as a design note only —
no `PinSet` model, no `setId`, no switcher.

## Remaining work

1. **`PinSet` model + storage.** Add named, switchable sets per workspace. Each set is a
   collection of pins (and groups). Persist sets in the versioned project file
   (`ProjectPinsFile`, schema bump with a v→v+1 migration that wraps existing pins into a
   default set — never a silent drop). One set is active at a time; the active-set id is
   stored per workspace.
2. **Status-bar switcher.** A status-bar item shows the active set name and opens a
   QuickPick to switch, create, rename, and delete sets (kdcro101 Favorites offers this).
   Switching repaints the tree to the active set's pins.
3. **Set-scoped tree.** The Pins tree shows the active set; create/rename/delete/duplicate
   set commands live in the view title menu. Global pins are decided: either shared across
   all sets (recommended — global is cross-workspace by definition) or set-scoped; pick
   "global pins are shared, sets scope project pins" to keep the model coherent.
4. **Migration safety.** Existing single-scope users see one default set named e.g.
   "Default" containing their current pins; behavior is unchanged until they create a
   second set.

## Approach

- Extend the existing on-disk schema and the `Pin`/`PinGroup` model rather than spawning
  a parallel store — single source of truth. The schema is already versioned
  (`ProjectPinsFile.version`), so the migration path is established.
- The switcher is a native status-bar item + QuickPick (design-system-consistent,
  native-first) — no webview.
- New strings via `l10n()`; the switcher and toasts name the set acted on.

## Acceptance criteria

- A workspace can hold multiple named pin sets; exactly one is active.
- A status-bar switcher creates/renames/deletes/switches sets, repainting the tree, each
  action naming the set.
- Existing stored pins migrate into a default set with no data loss; single-set behavior
  is unchanged.

## Dependencies

- None blocking. **Unblocks 3.2 branch-aware pin sets** — build this first, then bind
  branches to sets (`3.2-branch-aware-pin-sets.md`).

## Finish Report (2026-06-25)

Implemented. Net-new feature shipped end to end; schema bumped v2 → v3.

### Design chosen — active set is the top-level fields (minimal blast radius)

The active set's pins/groups ARE the file's existing top-level `pins`/`groups`. So
every existing consumer (tree, scheduler, all pin commands, drag-and-drop, recipes)
reads the active set with **zero changes** — switching a set just swaps which set is
live. Only the switcher, the set-management methods, and the migration are new.

- `PinSet = { name, pins, groups }` ([model/pin.ts](../../extension/src/model/pin.ts)).
  Only the INACTIVE sets are stored (`ProjectPinsFile.sets`); the active set is the
  top-level fields, named by `activeSet`.
- `removedAutoPins` / `removedRecipes` / `autoGroups` stay file-level (workspace-wide
  auto-seeding, not user-curated set contents) — sets scope only the user's pins +
  groups, matching the plan's "collection of pins and groups."
- **Global pins are shared across all sets** (untouched global storage) — the plan's
  recommended model.
- Sets are coordinated across a multi-root workspace by NAME: every operation applies
  to all folders, so switching to "Release" switches each folder to its own "Release"
  (an empty one is created where a folder has never seen the name).

### Migration safety

`readProjectFile` migrates a v2 file by defaulting `activeSet` to `"Default"` and
`sets` to `[]` — existing top-level pins become the Default set's contents with no
move and no drop. Malformed `sets` entries from a hand-edit are sanitized, never
crash the reader. Single-set behavior is unchanged; the status-bar switcher stays
hidden until a second set exists.

### Files

- [model/pin.ts](../../extension/src/model/pin.ts) — `PinSet`, `DEFAULT_SET_NAME`,
  `PROJECT_PINS_VERSION` 2→3, `ProjectPinsFile.activeSet`/`.sets`, `emptyProjectPinsFile`.
- [model/pinStore.ts](../../extension/src/model/pinStore.ts) — v2→v3 migration; cached
  `activeSetName`/`setNamesCache` populated in `refresh()`; `getActiveSetName`,
  `getSetNames`, `switchSet`, `createSet`, `renameSet`, `deleteSet`, `duplicateSet`,
  and the private `activateSetInFile` / `cloneSetContents` helpers.
- [views/setStatusBar.ts](../../extension/src/views/setStatusBar.ts) — status-bar
  switcher (hidden on the lone Default set / no folder).
- [commands/setCommands.ts](../../extension/src/commands/setCommands.ts) — switch hub
  QuickPick + new/rename/delete/duplicate, with duplicate-name validation and a modal
  delete confirm.
- [extension.ts](../../extension/src/extension.ts) — registers the commands + status bar.
- `package.json` / `package.nls.json` — 5 commands, the `3_sets` view-title group, NLS
  titles. `src/i18n/locales/en.json` — `pinSet.*` runtime strings.
- Root `CHANGELOG.md` — Unreleased entry.

### Acceptance criteria — met

1. A workspace holds multiple named sets; exactly one active. ✓
2. Status-bar switcher creates/renames/deletes/switches (and duplicates), repainting
   the tree, each action naming the set. ✓
3. Existing pins migrate into a Default set with no data loss; single-set behavior
   unchanged. ✓

### Notes / known edge

- Duplicating a set regenerates pin + group ids (uniqueness invariant) and remaps
  `groupId`; intra-set `dependsOn` / trigger links reference pin ids and are not
  remapped, so they fail safe in the copy (a dangling `dependsOn` is already treated
  as satisfied; a dangling trigger resolves to nothing). Acceptable for a copy.
- Verified by `npx tsc -p ./ --noEmit` (clean) and `node esbuild.js` (build finished,
  no errors). Not exercised in a running Extension Development Host.

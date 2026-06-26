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

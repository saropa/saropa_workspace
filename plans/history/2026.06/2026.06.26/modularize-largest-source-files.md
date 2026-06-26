# Modularize the largest extension source files

A code-quality scan flagged nine TypeScript source files over the project's
700-line hard cap (and seventeen over the 400-line warning), the largest being
`model/pinStore.ts` at 2046 lines. This work split those files along their natural
cohesion seams into focused sibling modules so no file exceeds the hard cap, with
every public export preserved so dependents need no changes.

## Finish Report (2026-06-26)

### Scope

VS Code extension only (`extension/src/**`, TypeScript). No Dart, no dependency,
no docs-only changes. Pure structural reorganization — method/function bodies are
byte-for-byte unchanged; only their file location and (for the store) member
visibility changed.

### What changed

Eleven oversized files were split into cohesive modules. Public export surfaces
were preserved — where a symbol moved, the original file re-exports it — so the
~37 dependent files import the same names from the same paths.

Logic-heavy files (free-function and class-shell extractions):

- `exec/runner.ts` (1403 -> ~130): `runPlanning`, `terminalRunner`,
  `externalLauncher`, `backgroundRunner`, `actionRunner` (the routine engine later
  split again into `routineRunner`). The thin dispatcher re-exports the moved
  symbols.
- `commands/pinCommands.ts` (1916 -> ~218): `pinExecution`, `pinInteraction`,
  `pinSelection`, `pinManagementCommands`, `pinConfigCommands`. The function-level
  cross-references between the helper modules are safe (no top-level execution).
- `import/favoritesImport.ts` (859 -> ~178): `favoritesKdcroBookmarks`,
  `favoritesOlegShilo`, `favoritesSettings`, `favoritesSibling`; the orchestrator
  re-exports the importers and shared types.
- `recipes/detectors.ts` (839 -> ~383): `detectorHelpers`, `detectorEcosystem`,
  `detectorRunTargets`. The 327-line `detectOnDemandRecipes` orchestrator stayed
  intact to avoid behavior risk.
- `commands/configureRun.ts` (821 -> ~380): `configureRunCommand`,
  `configureRunEnv`, `configureRunMode`.
- `views/dashboardPanel.ts` (921 -> ~485): inline CSS/JS assets to
  `dashboardAssets`.
- `views/plannerAssets.ts` (761 -> ~287): client script to `plannerScript`.
- `views/pinTreeItem.ts` (650 -> ~364): `pinRowFormatting`, `pinTreeItems`.
- `views/pinsTreeProvider.ts` (540 -> ~350): `pinTreeDragDrop` (the drag-and-drop
  controller) and `pinTreeNodes` (the per-row builders, which need only the store
  plus module-level run/badge/telemetry singletons).
- `exec/actionRunner.ts` (585 -> ~338): `routineRunner` (the routine-of-recipes
  engine).
- `extension.ts` (785 -> ~364): `activation/activationHelpers` and
  `activation/wiring` (secondary views, command-module registration, status bars,
  background engines, watchers).

The central data model `model/pinStore.ts` (2046, later 2171 after concurrent
feature work) was split into a linear inheritance chain rather than free functions,
so method bodies stay identical and `this` resolves naturally through the prototype
chain. Members were turned from `private` to `protected`; the public `PinStore`
API is unchanged. Each layer holds only callees its descendants need:

`PinStoreShared` (consts, helpers, `MoveTarget`) -> `PinStoreBase` (fields,
persistence I/O, query accessors) -> `PinStoreRecipes` (recipe + auto-pin
detection) -> `PinStoreRefresh` (`refresh`/`rescan` + async stat/seed passes) ->
`PinStoreMutationCore` (add/remove/rename + `mutatePin`/`placeAfter`) ->
`PinStoreMutation` (field-update/`setPin*` toggles, restore, promote) ->
`PinStoreSets` (pin sets) -> `PinStore` (concrete: user groups + move).

### Architecture notes

- The inheritance ordering is constrained: a method may only call methods declared
  in its own class or an ancestor. `promoteRecipe`/`restoreRecipes` (which call
  `refresh`) therefore sit in the mutation layer, not the recipes layer, even
  though they read as "recipe" operations.
- `PinStore`'s public constructor is inherited from `PinStoreBase`; the
  param-property `protected readonly context` controls only field visibility, so
  `new PinStore(context)` at the activation site is unaffected.
- Where helper modules reference each other (the pin-command split, the store
  chain), the references are function/method calls resolved at call time, never
  top-level module-init execution, so the import cycles are inert at runtime.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — production bundle builds.
- `npm test` (node --test over the bundled suite) — all tests pass, including the
  existing `pinStore.test.ts` (validating the unchanged public API across the new
  class chain), `pinTreeDragDrop.test.ts`, and `actionRunner.test.ts`.
- The code-quality file-length audit reports 0 files over the 700-line hard cap
  (down from 9). Remaining files in the 400-700 warning band are all under the cap.

Two slicing slips during the store split (a `newId()` body cut after its comment,
and an oversized 746-line mutation layer) were caught by the type-check and
corrected (the body completed; the mutation layer split into a core and a
field-update layer).

### Not a behavior change

No control flow, string, default, or persisted-format change. The split is
verifiable as a no-op by the unchanged test suite and the byte-identical method
bodies. The changelog records it under the `[1.5.0]` Maintenance section.

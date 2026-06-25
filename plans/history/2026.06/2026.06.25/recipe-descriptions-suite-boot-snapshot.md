# Recipe descriptions surfaced on click; suite-boot macro and toolchain snapshot

Detected recipes previously carried only a short label and their concrete action;
the explanatory prose for each recipe lived solely in the `plans/RECIPE_BOOK.md`
catalog, where an end user never saw it. This work moves that prose into the
product (shown on click and on hover), trims the catalog to forward-looking items
only, and builds the two cheapest remaining recipes — the suite-boot macro (#59)
and a basic toolchain snapshot (#62).

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript) under `extension/`, plus documentation
(`plans/RECIPE_BOOK.md`, `README.md`, `CHANGELOG.md`). No Flutter/Dart code.

### Change 1 — Recipe descriptions, surfaced on click and hover

A `description?: string` field was added to both `RecipeResult`
(`extension/src/recipes/detectors.ts`) and the persisted `Pin` model
(`extension/src/model/pin.ts`). Every built recipe was given a description stating
what running it does and which project file it was detected from:

- on-demand recipes 1–25 in `detectors.ts`,
- scheduled rituals 26–35 in `scheduledRecipes.ts`,
- Saropa Suite recipes 36–58 in `suiteRecipes.ts` (threaded through the `suite()`
  helper, which gained a `description` parameter).

`PinStore.buildRecipePins` copies the description onto each seeded recipe pin, and
`PinStore.promoteRecipe` carries it onto the stored pin so it survives promotion.

The description is surfaced at the two places a recipe is encountered:

- the single-click detail modal (`showActionInfo` in
  `extension/src/commands/pinCommands.ts`) now leads with the description, then the
  concrete action line, then any schedule note;
- the tree hover (`PinTreeItem` in `extension/src/views/pinTreeItem.ts`) leads with
  the description before the target line.

Rationale for surfacing on click rather than in a propose-QuickPick: the extension
has no propose step — recipes auto-seed into the Recipes tree, and a single click on
a non-file recipe pin already opens an informational modal (it deliberately does not
run, since a shell/scheduled recipe is a heavy side-effecting task). That modal plus
the tree tooltip are the actual click and hover surfaces.

`plans/RECIPE_BOOK.md` was rewritten to contain only forward-looking work (the live
process monitor, hygiene scans, sensory feedback, and the remaining gaps in shipped
sections), since the per-recipe prose now lives in code.

### Change 2 — Suite-boot macro (#59)

`pushSuiteMacro` in `suiteRecipes.ts` builds a `macro` recipe from the per-tool boot
commands already pushed by the individual suite detectors. Each step is keyed to the
presence of a specific seeded recipe id (`suite.drift.browser`,
`suite.lints.analysis`, `suite.log.open`) — those ids exist only when the owning
extension is installed, so every macro step targets a command that exists at run
time. The macro is created only when two or more such steps are present, so a
single-tool project never sees a multi-tool sequence. It dispatches through the
existing `runMacro` path, which already skips a step whose command is unavailable.

### Change 3 — Basic toolchain snapshot (#62) and Process Monitor group

A new recipe category `"monitor"` was added to `RecipeCategory`
(`detectors.ts`) and a corresponding synthetic group `"Process Monitor"` to
`RECIPE_GROUPS` (`pinStore.ts`). A new detector
`extension/src/recipes/processRecipes.ts` returns one always-applicable `shell`
recipe that captures the OS process table to `reports/$stamp_processes.md` and
auto-opens it, reusing the existing `runShellToReport` machinery (the same path the
scheduled rituals use). The capture command is chosen per platform at detection
time, constrained by the shell `runShellToReport` spawns
(`cp.spawn(cmd, { shell: true })`): `tasklist /v /fo table` on Windows (pure cmd,
no PowerShell quoting), and `ps -axo pid,ppid,pcpu,pmem,rss,comm | sort -k3 -nr |
head -n 40` on macOS/Linux. The detector is wired into the per-folder sweep in
`PinStore` alongside the other three detectors.

The snapshot is the "basic" slice: its CPU column is the OS's cumulative CPU time,
not the two-sample live delta the full monitor (#60/#61) will compute via a
process-poll helper. That helper, the live webview panel, and the heartbeat remain
unbuilt.

### Behavioral note

Because the toolchain snapshot is always applicable, the Recipes view now shows a
Process Monitor group in every project, so the "nothing detected" welcome content no
longer appears in a project that would otherwise yield no recipes. This is
intentional and matches the catalog's "always applicable" intent for the monitor.

### Verification

Full type-check (`npx tsc -p ./ --noEmit` from `extension/`) passes clean after all
changes. The repository contains no test source files (an `npm test` script points
at `out/test/runTests.js`, but no `*.test.ts` exist), so there were no tests to
audit or update; behavior in a running Extension Development Host (the macro firing
in a multi-tool project, the snapshot report writing and opening) is not verified by
automated means.

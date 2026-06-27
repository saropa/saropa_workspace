# Modularize oversized files and functions

The code-quality audit (`scripts/audit.py --quality`) flagged one source file over the
700-line hard cap and several over the 400-line warning threshold, plus a set of functions
exceeding the 50-code-line heuristic. This change splits the hard-cap file and the five
next-largest files into role-based modules, and decomposes the three longest functions into
grouped helpers, with no change to runtime behavior.

## Scope

VS Code extension TypeScript only (`extension/src/`). No Dart, no user-facing behavior
change. The webview client scripts and rendered HTML are byte-for-byte identical; command
registrations, their ids, and their handlers are unchanged.

## Files split (each result now under the 400-line warning threshold)

- `views/plannerScript.ts` (740, over the hard cap) → a thin host that concatenates five
  fragments under `views/planner/` (`plannerScriptCore`, `plannerScriptTimeline`,
  `plannerScriptWorkflow`, `plannerScriptInspector`, `plannerScriptBootstrap`). The one
  webview `<script>` string is reassembled in the original order; all fragments share a
  single runtime global scope (function declarations are hoisted together), so only the
  bootstrap fragment's ordering matters and it stays last. Reconstruction was verified to
  equal the original content.
- `views/scheduleEditorPanel.ts` (667) → `scheduleEditorShell.ts` (static HTML cards + CSP
  shell + `esc`/`shortcutName`) and `scheduleEditorInsights.ts` (the "Around your schedule"
  scheduling math: `buildInsights` + conflict/gap helpers). The panel keeps the
  host/protocol logic.
- `views/iconCatalog.ts` (592) → the generated keyword map moved to `iconKeywords.ts`
  (merging two data parts `iconKeywordsData1/2.ts`); the catalog re-exports `ICON_KEYWORDS`
  so it stays the single import surface for the Customize panel and its tests. No in-repo
  generator exists for this data (the "auto-generated" header refers to an external
  one-off), so the split is safe from clobbering.
- `views/configureRunPanel.ts` (588) → `configureRunShell.ts` (static HTML cards + CSP
  shell + `esc`/`shortcutName`). The store-reading cards take the store as a parameter.
- `model/shortcut.ts` (530) → type clusters moved to `shortcutAction.ts`, `shortcutExec.ts`,
  `shortcutSchedule.ts`, and `shortcutFile.ts`, all re-exported from `shortcut.ts` so every
  existing `../model/shortcut` import is unchanged. Cross-module references are type-only.
- `commands/configureSchedule.ts` (523) → the cron builder (preset menu + shared time
  prompt + `WEEKDAY_LABELS`) moved to `configureScheduleCron.ts`. The dependency is one-way
  (the main file imports `editCron`, never the reverse).

## Functions decomposed (each helper now under the 50-code-line heuristic)

- `registerPinManagementCommands` (174) → `registerGroupCreateCommands`,
  `registerGroupEditCommands`, `registerPinFileCommands`, `registerRecipeRestoreCommands`,
  plus the existing favorites-import registrar, called from a thin orchestrator.
- `pushWorkspaceRecipes` (147) → `pushEntryRecipe`, `pushDocRecipes`,
  `pushEnvAndConfigRecipes`, `pushBootAndLocalhostRecipes`, `pushVersionAndScriptRecipes`,
  awaited in the original order so catalog ordering is preserved.
- `registerPinConfigCommands` (138) → `registerRunConfigCommands`, `registerFileOpCommands`,
  `registerProcessControlCommands`, `registerScheduleTriggerCommands`,
  `registerLifecycleCommands`, called from a thin orchestrator.

## Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm run test:unit` — 796 pass / 0 fail.
- `scripts/audit.py --quality` — the hard-cap file and the five target files no longer
  appear over 400 lines; the three target functions and the interim 73-line group registrar
  no longer appear over the function-length threshold.

## Out of scope (left as the audit reported)

Fifteen pre-existing files remain over 400 lines and several functions over 50 lines outside
the agreed "hard cap + worst offenders" set. They were not touched.

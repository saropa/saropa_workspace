# Simulate Run (Dry Run / Audit Mode)

A shared or complex pin — a multi-step macro, or a run config full of `$tokens`
and `${prompt:…}` placeholders — could not be inspected before execution: the only
way to learn what it would run was to double-click it and find out. This adds a
read-only "Simulate Run" audit that renders the exact command, working directory,
run location, and environment a real run would use, executing nothing.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code involved.

### What changed
- **New command `saropaWorkspace.simulateRun`** ("Simulate Run…"), surfaced on the
  context menu of every pin kind (file, recipe, auto) in the Pins and Recipes
  views. Gated `when: false` in the command palette like the other pin-targeted
  commands, since it needs a pin argument.
- **New module `extension/src/commands/simulateRun.ts`.** It reuses `planRun` (the
  same pure command-assembly the runner and scheduler share) to compute the exact
  command line, cwd, run location, elevation, environment overrides, and any
  unrecognized `$placeholders` for a file pin, then renders them as Markdown. For a
  non-file recipe pin it describes the action (url / shell / command / macro),
  expanding `$workspaceRoot`/`$date`-style recipe tokens via the runner's
  `expandRecipeTokens` so the audit shows concrete values rather than raw tokens.
  Interactive `${prompt:…}` / `${pick:…}` tokens are answered virtually through the
  existing `resolveInteractiveTokens`; a cancel aborts the simulation with nothing
  rendered, mirroring a real run's cancel.
- **Read-only preview surface.** A `TextDocumentContentProvider` on the
  `saropa-simulate` scheme backs the preview, opened via the built-in
  `markdown.showPreview`. A virtual document (not an untitled buffer) keeps the
  audit clean — no dirty editor to dismiss, no risk of editing/saving — and content
  is keyed by pin id so re-simulating a pin refreshes its existing preview rather
  than stacking tabs. The provider and its emitter are pushed to
  `context.subscriptions` for disposal on deactivation.
- **`expandRecipeTokens` exported from `exec/runner.ts`** (previously private) so the
  audit resolves a recipe's shell/cwd from the single source of truth the real run
  uses, rather than a second copy.

### Why it is correct / safe
Every code path in the feature is read-only: it resolves and formats, but never
spawns a process, writes a file, or mutates a pin. `planRun` is already documented
as pure of side effects (both `runPin` and the scheduler's log line depend on that),
so reusing it guarantees the simulated command matches what would actually run. The
empty-command-line case (a plain document with no interpreter) is detected and
reported as "would open the file" instead of showing a misleading empty command.

### Verification
- `npx tsc -p ./ --noEmit` → exit 0.
- `node esbuild.js` → bundle built, exit 0.
- No automated tests were run: the extension has no test harness (no `test/`
  directory, no `*.test.ts`, no wired runner). Verified by type-check, build, and
  inspection. The report builders (`buildFileReport`, `buildActionReport`,
  `locationLabel`, `envSection`) are pure and unit-testable should a harness be
  added later.

### Localization
Runtime strings added to `src/i18n/locales/en.json` under the `simulate.*` keys and
the manifest title `command.simulateRun.title` to `package.nls.json`. This repo has
no machine-translation pipeline, so no catalog regeneration applies.

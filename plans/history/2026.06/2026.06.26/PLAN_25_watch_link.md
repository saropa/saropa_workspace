# Plan — #25 "Watch This" Linkage (If-This-Then-Run-That)

## Pain
You edit `schema.graphql` but forget to run `generate-types.sh`, and TS errors surface
ten minutes later.

## Target behavior
Link a watched file (or glob) to a script pin: when that file is saved, the script runs
in the background with a quiet success toast.

## Approach
> **Overlap note:** another session shipped **run-on-save** (a pin runs when *its own*
> file is saved) and the trigger/chain engine (`exec/chainRunner.ts`,
> `exec/systemEvents.ts`, `model` `triggers`). #25 is the **cross-file** case: run pin X
> when file Y is saved. Build it as an extension of that existing save/trigger
> infrastructure, not a parallel one. Read `configureRun`'s run-on-save handling and the
> trigger model before starting.

### Model
Add watch globs to the script pin's trigger/exec config (extend the existing inventory):
e.g. `PinTrigger` gains an `onSave` variant carrying `globs: string[]`, OR
`PinExecConfig.runOnSaveGlobs?: string[]`. Prefer whichever the run-on-save feature
already uses so the two share one save listener.

### Save listener
- A single `workspace.onDidSaveTextDocument` handler (the run-on-save one if it exists):
  for each saved document, find script pins whose watch globs match the saved path
  (workspace-relative, `vscode`'s `RelativePattern`/minimatch) and run each in the
  **background** through the existing run entry point + per-pin cooldown (so a rapid
  save burst does not spawn a storm).
- Quiet success toast naming the script and the file that triggered it.

### Linking gesture
- Primary: a command **Run This Pin When a File Changes** on a script pin → pick a file
  or type a glob → store it. Simple, discoverable, no drag ambiguity.
- Optional (pitch's drag): the tree DnD controller already handles pin→pin internal drops
  for **reorder**. Distinguishing "drop file-pin onto script-pin to link" from "reorder"
  is ambiguous on the same gesture; if added, require a modifier or a drop-on-the-row
  confirm ("Link <file> to run <script> on save?"). Recommend shipping the command first;
  treat drag as a follow-up.

## Files & changes
- `model/pin.ts` — watch-globs on the trigger or exec config (extend existing).
- `model/pinStore.ts` — mutator to set/clear the watch globs.
- The shared save listener (extend run-on-save) — glob match → background run + cooldown.
- `commands/...` — "Run This Pin When a File Changes" command + menu.
- `package.json` / nls / en.json — command, menu, strings, success toast.

## Deviations / limits
- The drag-to-link gesture is deferred in favor of an unambiguous command (drag collides
  with the existing reorder DnD). Note this in the finish report.

## Risks / blast radius
- A save-triggered run that itself writes a watched file could loop — the per-pin
  cooldown + excluding the script's own outputs from its watch globs prevents a storm;
  verify.
- Coordinate with the run-on-save owner so there is **one** save listener, not two.

## Verification
`tsc` + `esbuild`; manual: link `schema.graphql` to a script pin, save the file, confirm
the script runs in the background and toasts, and that a save storm runs it at most once
per cooldown.

## Complexity & risk
Low-to-moderate, mostly an extension of shipped run-on-save infrastructure. The main care
is sharing the save listener and the loop guard.

## Finish Report (2026-06-26)

### Scope
VS Code extension (TypeScript) only. No Dart/Flutter code.

### What changed
Cross-file watch links let a pin run when a *different* file is saved, extending the
existing run-on-save infrastructure (a pin running when its *own* file is saved) rather
than introducing a parallel mechanism.

- **`extension/src/model/pin.ts`** — `PinExecConfig` gains `runOnSaveGlobs?: string[]`,
  placed beside `runOnSave` so the one save listener reads both. Absent/empty by default,
  so no pin reacts to a foreign save unless explicitly linked.
- **`extension/src/exec/globMatch.ts`** (new) — a dependency-free POSIX-glob matcher
  (`*`, `**`, `**/`, `?`, literals; forward-slashed, case-sensitive). VS Code exposes no
  public synchronous path-vs-glob API (`RelativePattern` only feeds a watcher), and adding
  `minimatch` was rejected under the blast-radius gate for the few patterns a link carries.
- **`extension/src/model/pinStore.ts`** — `setPinWatchGlobs(pin, globs)` mutator; trims
  blanks, clears the field when empty, leaves other exec settings intact. Routed through
  `mutatePin`, so it no-ops on an auto/recipe pin.
- **`extension/src/activation/activationHelpers.ts`** — `runPinsOnSave` extended with a
  second pass, `runWatchLinksOnSave`. It matches the saved file's workspace-relative path
  AND absolute path (both forward-slashed) against each pin's globs, forces the run to the
  background via the now-exported `toBackground`, applies a per-pin 3 s cooldown
  (`watchLastRun` map) to collapse a save burst, honors the single-instance guard
  (`runBlockReason`), and de-dupes against pins already fired by the own-file run-on-save
  pass so a pin that both targets and globs the saved file runs once.
- **`extension/src/exec/chainRunner.ts`** — `toBackground` exported (was file-local) so the
  watch pass reuses the single force-background clone instead of re-deriving it.
- **`extension/src/commands/configureWatchLink.ts`** (new) + registration in
  `pinCommands.ts` — the **Run This Pin When a File Changes** command: a QuickPick hub to
  add a watched file (picker) or glob (input), remove entries, and save. Auto/recipe pins
  are rejected (nowhere to persist), matching `configureRun`.
- **`extension/package.json` / `package.nls.json` / `i18n/locales/en.json`** — the command,
  its context-menu entry (config group, beside Configure Triggers), the palette
  `when:false` guard, the command title, and the runtime strings (hub labels, prompts,
  toasts, and the `[Watch]` channel audit lines).
- **`CHANGELOG.md`**, **`README.md`** (trigger list + command table), **`docs/FEATURES.md`**
  (trigger section) — feature documented alongside run-on-save.
- **`extension/src/test/globMatch.test.ts`** (new) — 8 unit tests pinning the wildcard
  semantics (segment vs cross-segment, anchoring, the `**/` zero-or-more-segments case,
  `matchesAnyGlob` blank/empty handling).

### Why it is safe
- **No save loop:** `onDidSaveTextDocument` fires only on editor saves, not on a script's
  programmatic file writes, so a watch run that writes files cannot re-trigger the listener.
  The per-pin cooldown is the additional storm guard for rapid manual saves / Save All.
- **Opt-in and inert by default:** absent globs mean no reaction; a paused pin is skipped
  like every other unattended runner.
- **Background-forced:** a foreign save never steals the terminal or pops an OS window.

### Verification
- `npx tsc -p ./ --noEmit` (from `extension/`) — clean.
- `node esbuild.js` — bundle builds.
- `globMatch.test.ts` — 8/8 pass (built and run scoped, not the full suite).

### Deviations / limits
- **Drag-to-link gesture deferred** (as the plan anticipated): the tree's internal drag
  already means "reorder," so dropping a file-pin onto a script-pin to link would collide.
  The unambiguous command ships instead.
- **No extra success toast:** the run path already toasts "Running {name}" and
  "{name} finished," so a third toast would be noise. The triggering file is named in the
  output-channel audit line (`[Watch] Running {name} - {file} changed.`), consistent with
  how the chain runner logs causes. This satisfies the plan's "name the file that triggered
  it" intent without double-toasting.

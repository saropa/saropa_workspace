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

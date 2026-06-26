# Plan — #18 Idle-Triggered Routines (The "Coffee Break" Runner)

## Pain
A 4-minute, CPU-heavy `run_all_integration_tests` script you avoid running while typing,
mean to run before pushing, and forget.

## Target behavior
A new run trigger: **Run on idle**. After N minutes (default 3) with no editor input,
the pin runs in the background once; a finished badge waits when the user returns. It
re-arms only after the next burst of activity, so it fires at most once per idle period.

## Approach
This is a new trigger source alongside the schedule + the chain/event triggers other
sessions added (`exec/chainRunner.ts`, `exec/systemEvents.ts`, `model` `triggers`). Reuse
that trigger plumbing where possible.

### Model
Extend the schedule/trigger config rather than adding a parallel field. Options:
- Add `idleMinutes?: number` to `PinSchedule` (idle is a scheduling concept), OR
- Add an `idle` variant to the existing `PinTrigger` union.
Pick the trigger union if that is where build/git/after-pin triggers already live, so
"run on idle" sits with the other automatic causes and reuses the per-pin cooldown +
audit logging.

### Idle detector (`exec/idleMonitor.ts`, new)
- A singleton tracking last-activity time. Reset on `window.onDidChangeWindowState`
  (focus), `onDidChangeTextEditorSelection`, `onDidChangeActiveTextEditor`,
  `onDidChangeTextDocument`. A single `setInterval` checks `now - lastActivity` against
  the smallest configured idle threshold.
- When the threshold is crossed AND not already fired this idle period, emit
  `onDidGoIdle`. Set a "fired" flag; clear it on the next activity event so the next idle
  period can fire again.
- Disposed on deactivate; all listeners pushed to subscriptions.

### Wiring
On `onDidGoIdle`, run every pin marked run-on-idle whose threshold has been reached, in
the **background** (idle work must not steal the terminal), routed through the same run
entry point + cooldown the chain engine uses. The completion badge is the existing
last-run badge — no new surface needed.

### Config UI
Add an **Run on idle** field to `commands/configureSchedule.ts` (or `configureTriggers.ts`,
matching where the trigger lives): on/off + the idle minutes.

## Files & changes
- `model/pin.ts` — idle field on `PinSchedule` or `PinTrigger`.
- `exec/idleMonitor.ts` (new) — activity tracking + idle event.
- `exec/chainRunner.ts` / scheduler wiring — handle the idle event → background run with
  cooldown.
- `commands/configureSchedule.ts` or `configureTriggers.ts` — the config field.
- `extension.ts` — construct the idle monitor; subscribe.
- `package.nls.json` / `en.json` — field labels + a "ran while you were away" toast.

## Deviations / limits
- VS Code idle is **editor-scoped**, not OS-wide: it tracks input to the editor, not
  mouse movement across the OS. Document that "idle" means "no VS Code interaction",
  which is the right signal for "you stepped away from coding".
- Only **background** runs are sensible on idle; disallow terminal/external for the idle
  trigger (or force background) so an unattended run never hijacks focus.

## Risks / blast radius
- An idle run that itself causes activity (writing files the editor reloads) could
  reset/avoid re-trigger — the once-per-idle-period flag prevents a storm; verify the run
  does not re-arm itself.
- Heavy idle jobs spiking CPU when the user returns — acceptable per the pitch, but the
  finished badge + optional toast must make clear a run happened.

## Verification
`tsc` + `esbuild`; manual: mark a quick script run-on-idle with a 1-minute threshold,
stop typing, confirm it runs once and badges, and does not re-run until you type again.

## Complexity & risk
Moderate. Low blast radius if it reuses the existing trigger/cooldown plumbing; the idle
detector is small and self-contained.

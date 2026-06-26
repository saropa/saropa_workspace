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

## Finish Report (2026-06-25)

Status: Complete.

### What shipped
A "Run when idle" pin trigger. After a per-pin number of minutes with no VS Code
interaction, the pin runs once in the background; it re-arms only after the next burst
of activity, firing at most once per idle period.

The trigger union was extended rather than a parallel field added: `PinTrigger` gained
`{ kind: "idle"; minutes: number }` (`extension/src/model/pin.ts`), so run-on-idle sits
with the existing pin/event causes and reuses the chain engine's per-pin cooldown and
output-channel audit log.

### Components
- `exec/idleMonitor.ts` (new) — an editor-idle detector. It records a last-activity
  timestamp, reset on window focus regained, cursor/selection movement, and active-editor
  switch. A poll timer (15s, armed only while at least one idle-triggered pin exists)
  fires `onDidGoIdle(minutes)` once for each configured threshold the idle span crosses
  within a period; the fired set clears on the next activity. The monitor fires the exact
  threshold crossed (not the raw idle span), so a 3-minute pin never re-runs when a
  separate 10-minute pin's boundary is later crossed in the same period.
- `exec/chainRunner.ts` — subscribes to the monitor, re-derives the distinct thresholds on
  every store change, and on an idle crossing runs every pin whose idle trigger names that
  threshold. Idle runs are forced to the background channel via a shallow per-run clone
  (`toBackground`); a pin needing interactive `${prompt}`/`${pick}` input is skipped
  (an unattended run cannot answer it), matching the scheduler's stance. The existing
  per-pin cooldown and audit-log path are reused unchanged.
- `commands/configureTriggers.ts` — a "Run when idle..." hub action prompts for whole
  minutes (default 3) and writes a single idle trigger per pin (a second would run the pin
  twice per idle period, so an existing one is replaced).
- `views/plannerPanel.ts` — an idle trigger draws no chain-graph edge (it has no source
  node); the graph-build and trigger-removal paths were updated to handle the new kind
  explicitly instead of assuming pin-or-event.
- `extension.ts` — constructs the `IdleMonitor` and hands it to the `ChainRunner`; both
  are disposables released on deactivation.
- `i18n/locales/en.json` — trigger labels, the idle audit line, and the
  interactive-skip message.

### Design decision: text-document changes are not activity
A `vscode.workspace.onDidChangeTextDocument` event is deliberately excluded from the
activity signals (the plan listed it and separately flagged a self-retrigger risk). An
idle run that writes files the editor reloads would fire that event, reset the idle clock,
and — after another idle stretch — re-run, looping. Human typing already moves the cursor,
which `onDidChangeTextEditorSelection` catches, so dropping the document signal loses
nothing for presence detection while closing the loop. Window blur is likewise not
activity: stepping away must let the idle span accrue, so only the focused transition
resets.

### Verification
- `extension/src/test/idleMonitor.test.ts` (new, 5 cases) pins the behavior under Node's
  mock timers: ordered once-per-threshold firing, re-arm after activity, the focus-resets
  / blur-does-not asymmetry (which proves the self-retrigger guard direction), threshold
  clearing stops the poll, and duplicate/non-positive thresholds collapse. The test stub
  (`src/test/_stub/vscode.ts`) gained a minimal `EventEmitter` and the three window
  activity events with `__fire*` drivers.
- Full unit suite: 87 passing, 0 failing. `tsc --noEmit`: clean. `esbuild`: bundles.
- Device/manual verification of the live run is listed in the handoff (a unit test cannot
  exercise the real VS Code event timing).

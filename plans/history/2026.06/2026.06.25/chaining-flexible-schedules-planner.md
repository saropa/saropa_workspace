# Recipe chaining, flexible schedules, and the Schedule & Workflow Planner

The pin model could only run a pin manually or on a daily-time / fixed-interval
schedule, with no way to run one pin after another or react to a build / publish /
git event, and no visual surface for any of it. This change adds pin-to-pin and
event chaining, day-of-week and unit-based scheduling, and a three-view webview
(Day timeline, Week drag-to-retime calendar, Workflow node graph) that drives all of
it.

## Finish Report (2026-06-25)

### Objective

Make pins composable and their automation visible: (1) chain a pin to run after
another pin or after a system event (build / publish / git commit / git push), (2)
schedule on specific weekdays and at every-N-hours/days cadences, and (3) provide a
beautiful, local-only webview to see and edit the schedule and the chain graph
directly — including drag-to-retime and a drag/right-click workflow editor.

### What changed

**Model (`extension/src/model/pin.ts`).** Extended the existing objects rather than
adding parallel surfaces:

- `SystemEventName` (`build` / `publish` / `gitCommit` / `gitPush`) and the
  `SYSTEM_EVENTS` list (single source for pickers and the graph's event nodes).
- `PinTrigger` discriminated union: `{kind:"pin", pinId, onlyOnSuccess?}` or
  `{kind:"event", event}`.
- `Pin.triggers` (auto-run causes) and `Pin.emits` (events this pin's completion
  fires).
- `PinSchedule.days` (local weekday set; empty = every day) qualifying the daily
  time; the interval stays a single `everyMs` (the editor surfaces units but stores
  ms, so the schedule math keeps one source of truth).

**Schedule math (`extension/src/exec/schedule.ts`).** `nextDailyTime` now walks
today..+7 and returns the first allowed-weekday slot, so a non-empty `days` set
always resolves within a week. With no `days` it reduces exactly to the prior
today/tomorrow behavior, so existing daily schedules are unchanged. The DST-safe
day stepping was generalized to an offset (`atLocalTimeWithOffset`).

**Event engine (three new files).**

- `exec/pinEvents.ts` — a completion bus. The runner fires `fireComplete(pinId,
  outcome)` where outcome is `success` / `failure` (tracked background and report
  runs) or `dispatched` (terminal / external / url / command / macro runs that have
  no observable exit). One-directional imports: the runner and the chain runner both
  import the bus, never each other.
- `exec/systemEvents.ts` — a system-event bus plus `GitEventWatcher`, which fires
  `gitCommit` / `gitPush` by watching `.git/logs/HEAD` and
  `.git/logs/refs/remotes/**` with debounced `FileSystemWatcher`s (no `git` process
  spawned; the explicit RelativePattern watcher receives `.git` events the global
  watcher's exclude hides).
- `exec/chainRunner.ts` — subscribes to both buses. On a pin completion it forwards
  that pin's `emits` (only on a non-failing completion) and runs the pins triggered
  directly after it (honoring `onlyOnSuccess`); on a system event it runs the pins
  triggered by it. A per-pin cooldown (`COOLDOWN_MS = 3000`) breaks trigger cycles
  and storms (A→B→A); each fire and each suppressed re-entry is logged to the output
  channel as an audit trail. Dependents run through the normal Run command, so each
  fires its own completion and the chain propagates.

**Runner wiring (`exec/runner.ts`).** `pinEvents.fireComplete` is fired at five
points: the background `settle()` and the captured-to-report finish (real outcome),
and the terminal / external paths in `runPin`, the url / command / macro paths in
`runAction`, and the terminal branch of `runShellAction` (dispatch). No path
double-fires.

**Store (`model/pinStore.ts`).** `updatePinTriggers(pin, triggers, emits)` persists
both through the existing `mutatePin` primitive (empty arrays collapse to undefined).

**Schedule editor (`commands/configureSchedule.ts`).** A **Days of week** hub field
(multi-select with Weekdays / Weekends shortcuts; empty = every day, dropped when
all 7 or no daily time) and a unit-aware custom interval (minutes / hours / days).
`describeInterval` now renders days. Days are dropped from the stored shape unless a
daily time is set.

**Triggers editor (`commands/configureTriggers.ts`, new).** A hub-and-spoke
QuickPick mirroring Configure Schedule / Boot Sequence: add a pin trigger (excludes
self and already-linked pins), add an event trigger, toggle each pin trigger's
success gate, and multi-select the pin's emitted events (build / publish only —
git events are repo-detected, not emittable). Registered as
`saropaWorkspace.configureTriggers` in the pin's `2_edit` context menu.

**Planner webview (`views/plannerPanel.ts` + `views/plannerAssets.ts`, new).** A
single-instance "Schedule & Workflow Planner" panel, opened by
`saropaWorkspace.openPlanner` (Pins view toolbar + palette). It builds one graph
payload from the store (pins + synthesized event nodes for wired events; edges from
each pin's triggers) and renders three views client-side:

- **Day** — a 24-hour SVG ruler with a live now-line, staggered daily-pin markers,
  and interval pins as cadence chips.
- **Week** — a 7-day × 24-hour calendar; each scheduled pin is a draggable block.
  Vertical drag retimes (snapped to 15 minutes); a drop onto another day column
  moves that occurrence (swaps the dragged weekday for the target in the day set, or
  just retimes for an every-day pin). Writes through `updatePinSchedule`, which
  re-arms the scheduler.
- **Workflow** — absolutely-positioned nodes with SVG bezier edges and arrowheads;
  drag nodes (positions persisted in `workspaceState`), drag a node's plug onto
  another pin to chain them, drag a toolbox event chip onto a pin to add an event
  trigger, right-click a node for run / open / schedule / triggers / pause / remove,
  and right-click the canvas for an autocomplete link builder.

The visual language follows the shared Saropa dashboard chrome (token `:root`, hero
band with a brand-orange radial tint, segmented tabs, pill buttons, pop/rise
animations, focus-visible rings, `prefers-reduced-motion` guard). Local-only: strict
CSP with a per-load nonce, no remote or bundled resource, themed entirely via
`--vscode-*`. Every mutating message routes through the same store methods and Run
command the tree uses; the panel repaints on `store.onDidChange` and
`runStatusRegistry.onDidChange`.

**Manifest / l10n.** `configureTriggers` + `openPlanner` commands, the pin context
menu and Pins-view toolbar entries, the palette gating, NLS titles, and the
`triggers.*` / `chain.*` / `planner.*` / `schedule.days.*` / `schedule.unit.*`
runtime strings.

### Design decisions

- **Extend, don't fork.** Triggers/emits/days are fields on the existing Pin /
  PinSchedule objects; the interval stays one `everyMs`. No parallel parameter
  surfaces.
- **`dispatched` outcome.** Untracked runs have no exit code, so they chain on
  dispatch and count as success for triggering (there is no failure signal to gate
  on). Only background/report runs carry a real success/failure for `onlyOnSuccess`.
- **Cooldown over graph analysis.** A per-pin 3s cooldown is a robust, simple
  cycle/storm breaker that still lets independent chains run concurrently; a full
  cycle-detection pass was unnecessary.
- **build/publish are pin-marked, git is repo-detected.** There is no generic build
  system here, so "a build happened" = "a pin marked `emits:["build"]` finished";
  git events come free from the `.git` log watcher.
- **One panel, not a bundled graph library.** The graph, timelines, drag-and-drop,
  context menu, and autocomplete are hand-written in the inlined script — no new
  dependency, no bundled asset, consistent with the existing Saropa Dashboard.

### Verification

`npx tsc -p ./ --noEmit` clean (0 errors); `node esbuild.js` builds (exit 0); the
three hand-edited JSON files (`package.json`, `package.nls.json`,
`src/i18n/locales/en.json`) parse; the inlined webview script was extracted via
esbuild and passed `node --check`. No automated test harness exists in this
repository, so the runtime behavior (chain firing, git-log detection, and the
webview's drag / link / autocomplete interactions) is verified manually — see the
handoff. The pure schedule math (`nextOccurrence` with `days`) and the chain
predicate are unit-testable once a runner is established.

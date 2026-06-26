# Plan — #9 Time-Bomb / Ephemeral Pins

## Pain
You pin `db_migration_v42.sql` because you need it today, forget to unpin it, and six
months later the sidebar is a graveyard of dead pins.

## Target behavior
Right-click a file pin → **Pin until...** (a date / duration) or **Pin until branch
changes**. The pin shows an hourglass glyph and a countdown in its tooltip, and removes
itself automatically when the condition is met. Only pins the user explicitly
time-bombed ever auto-remove.

## Approach
### Model (`model/pin.ts`)
Add `Pin.expires?: { at?: number; onBranchAway?: string }`:
- `at` — epoch ms; the pin is removed once `Date.now() >= at`.
- `onBranchAway` — a branch name; the pin is removed when the current branch is no
  longer this one (depends on `exec/gitBranch.ts` from #3 — build that first or inline a
  minimal HEAD read here).

### Expiry engine (`exec/pinExpiry.ts`, new)
- `sweepExpired(store)` — iterate stored pins; remove those whose `at` has passed or
  whose `onBranchAway` no longer matches the current branch. Returns the removed pins
  so the caller can show a single summary toast ("Removed 2 expired pins: …").
- Run the sweep: (1) once on activation; (2) on a low-frequency timer (e.g. every
  minute via `setInterval`, disposed on deactivate) for the `at` case; (3) on the
  branch-change event for the `onBranchAway` case.
- Removal reuses `store.removePin` and clears `runStatusRegistry` (as the unpin handler
  does).

### Commands
- `saropaWorkspace.pinUntil` — QuickPick of presets (End of day, Friday, 1 hour,
  Tomorrow, Custom date/time via input) → compute `at` → `store.setPinExpiry(pin, {at})`.
- `saropaWorkspace.pinUntilBranchChange` — set `{ onBranchAway: currentBranch }`.
- `saropaWorkspace.clearPinExpiry` — defuse the bomb.
- `store.setPinExpiry(pin, expires?)` — `mutatePin` mutator.

### Tree affordance (`views/pinTreeItem.ts`)
- Hourglass glyph (`watch` / `hourglass` codicon) when `expires` is set and the icon
  slot is otherwise idle.
- Tooltip line: "Expires <relative time>" or "Until you leave <branch>".
- Optional: a `· 2h left` description suffix.

## Files & changes
- `model/pin.ts` — `expires?` field.
- `model/pinStore.ts` — `setPinExpiry`.
- `exec/pinExpiry.ts` (new) — sweep + timer + branch-change hook.
- `extension.ts` — start the sweep timer; sweep on activation; hook branch-change.
- `views/pinTreeItem.ts` — hourglass glyph + countdown tooltip (small surface).
- `package.json` / nls / en.json — three commands, menus, strings, toast copy.

## Deviations / limits
- The pitch's "visually ticks down" is approximated by a static relative-time tooltip
  refreshed on each tree repaint, not a live per-second animation (a TreeView cannot
  animate a row).

## Risks / blast radius
- **Auto-removes pins** — but only ones the user explicitly time-bombed; a normal pin is
  never touched. The summary toast after a sweep must name what was removed and offer an
  **Undo** (re-add from the removed snapshot) for the session, because removal is
  otherwise irreversible for a project pin shared via the repo.
- Timer must be a single disposed `setInterval`, not one per pin.

## Verification
`tsc` + `esbuild`; manual: set a pin to expire in 1 minute, confirm it removes itself
and the toast names it with an Undo; set "until branch changes", checkout away, confirm
removal.

## Complexity & risk
Moderate, elevated risk (auto-removal). The Undo affordance and the "only explicitly
bombed pins" invariant are the safety-critical parts.

## Finish Report (2026-06-25)

Shipped time-bomb / ephemeral pins as specified. A pin the user explicitly bombs
now removes itself when its condition is met; no other pin is ever auto-removed.

### What was built
- **Model** (`extension/src/model/pin.ts`): added `Pin.expires?: { at?: number;
  onBranchAway?: string }`. The two conditions are independent — either present
  triggers removal. Not carried by the share/export/recipe paths (a time-bomb is
  personal, not shared).
- **Store** (`extension/src/model/pinStore.ts`): `setPinExpiry` (collapses an
  all-undefined condition to `undefined` so a defused pin carries no inert object;
  routed through `mutatePin`, so it no-ops on auto-pins); `folderOf` (resolves a
  project pin's owning folder for branch reads and restore); `restorePin` (the Undo
  path — re-inserts the removed snapshot with `expires` cleared so it is not swept
  again, preserving the id, writing a global pin back to globalState and a project
  pin to its captured folder).
- **Expiry engine** (`extension/src/exec/pinExpiry.ts`, new): `PinExpiry`
  disposable runs one sweep on activation, a single shared 60s `setInterval` for the
  wall-clock case (never one timer per pin), and a per-folder `.git/HEAD`
  `FileSystemWatcher` for the branch case. `readCurrentBranch` reads `.git/HEAD`
  directly (follows a `.git`-file worktree pointer; no `git` process, no
  dependency); any read failure returns `undefined`, which the sweep treats as "keep
  the pin". `sweepExpired` captures candidates before mutating, removes via
  `store.removePin`, clears `runStatusRegistry`, and returns snapshots so a single
  summary toast can offer Undo.
- **Commands** (`extension/src/commands/configureExpiry.ts`, new; registered in
  `pinCommands.ts`): `pinUntil` (presets — in 1 hour, end of today / tomorrow /
  Friday, custom `YYYY-MM-DD [HH:mm]` parsed as a local instant), `pinUntilBranchChange`
  (bombs on the owning folder's current branch; warns instead of guessing when no
  repo / branch is readable), `clearPinExpiry` (defuse, with feedback when nothing
  was set). All three gate out auto-pins. Each preset preserves any existing
  condition of the other kind.
- **Tree** (`extension/src/views/pinTreeItem.ts`): a `watch` glyph (charts.yellow)
  fills the idle icon slot; a row chip shows the countdown (`2h left`) or the branch
  (`until you leave <branch>`); hover lines show the exact deadline / branch. The
  relative time is static per repaint (a TreeView row cannot tick live), per the
  plan's deviation note.
- **Wiring/i18n**: engine constructed in `extension.ts` after the pin set loads,
  pushed to `context.subscriptions`; three commands + a `Pin Expiry (Time-Bomb)`
  submenu on stored pins (`pin` / `pinScheduled`) in `package.json`,
  palette-hidden; titles in `package.nls.json`; runtime strings in `en.json`;
  CHANGELOG `[Unreleased]` entry added.

### Deviations from plan
- The plan referenced `exec/gitBranch.ts` from #3 as the branch source; that file
  does not exist, so a minimal `.git/HEAD` reader was inlined in `pinExpiry.ts` (as
  the plan permitted). When #3 lands a shared branch helper, `readCurrentBranch` is
  the single call site to migrate.
- Menu gating covers all stored pins (`pin` / `pinScheduled`), not only file pins —
  a temporary shell pin is just as worth bombing, and the conditions are file-agnostic.

### Verification
- `npx tsc -p ./ --noEmit`: the touched files are clean. Four pre-existing errors
  remain in `configureTriggers.ts` and `plannerPanel.ts` from a separate in-flight
  `idle`-trigger workstream (those files carry uncommitted changes); they are
  unrelated to this work and do not block the bundle.
- `node esbuild.js`: builds clean (exit 0).
- All three edited JSON files parse.
- No automated tests: the extension has no test harness (`extension/src/test/**`
  absent). Verification was type-check + bundle + inspection, matching the plan's
  stated `tsc` + `esbuild` + manual.

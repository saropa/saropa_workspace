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

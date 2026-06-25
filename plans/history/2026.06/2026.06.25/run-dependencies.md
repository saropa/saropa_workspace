# Make one pin wait for another to succeed

Double-clicking Deploy before Build finished produced broken deploys. This adds a
`dependsOn` field so a pin names a prerequisite that must have run successfully this
session; until then the pin is shown locked and running it is blocked with an offer to
run the prerequisite first.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`PinExecConfig.dependsOn?: string`** (model/pin.ts): the id of a prerequisite pin.
- **`exec/dependencies.ts`** (new): `dependencyState(pin, findPin)` returns the unmet
  prerequisite id, or nothing when there is no dependency, the prerequisite succeeded
  this session (read from `runStatusRegistry`), or the prerequisite no longer exists (a
  dangling id is treated as satisfied so a pin can never be permanently unrunnable).
- **Run gate** (`commands/pinCommands.ts`): `runPinCommand` calls `ensureDependency`
  first; when the prerequisite is unmet it shows a warning naming it and a one-click
  **Run <prerequisite>** action, then returns without running the gated pin. The
  prerequisite is not chained automatically — it may prompt, take time, or fail, so the
  user re-runs the gated pin once it succeeds. Covers every manual run path
  (double-click, play, Run Pin…, Run with Last Parameters, Run Top Pin); scheduled
  fires deliberately bypass the gate (they are time-driven).
- **Tree lock** (`views/pinTreeItem.ts` + `pinsTreeProvider.ts`): a new `lockedBy`
  parameter renders a lock glyph, a "waiting on <prerequisite>" badge (winning over a
  schedule / last-run badge while resting), and a tooltip line. The provider computes
  it via `dependencyState` and repaints on `runStatusRegistry` changes, so a pin
  unlocks the instant its prerequisite succeeds.
- **Configure Run hub** (`commands/configureRun.ts`): a new **Depends on** field picks
  the prerequisite from the other pins (recipes and self excluded) or clears it; the
  hub shows the prerequisite's name, not its id.

### Why session-scoped
`runStatusRegistry` is in-memory and per-session by design — a run result is only
meaningful for the session that produced it. So a fresh window starts with nothing
satisfied, which is the correct safety posture: a stale prior-session build must be
re-run before a deploy.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; en.json parse-validated. No test
harness in the extension; verified by type-check, build, and inspection. `dependencyState`
is pure (given a `findPin`) and unit-testable.

### Notes
A circular dependency (A needs B, B needs A) is the user's configuration error; the
gate never auto-chains, so it cannot loop — each "Run <prerequisite>" is a separate
user action.

### Localization
`configure.field.dependsOn` / `configure.dependsOn.*` and `depends.*` strings added to
`en.json`. No MT pipeline in this repo.

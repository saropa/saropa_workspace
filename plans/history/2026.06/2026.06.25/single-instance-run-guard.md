# Single-instance run guard

Pins could start a fresh run while one of their own runs was still in flight: a
scheduled slot, a chained trigger, a run-on-save, or a manual click each launched
unconditionally, so an hourly job that hung would stack up copies of itself (and a
heavy job such as a 4 GB CUDA model could run twice at once). This change makes a pin
single-instance by default — blocking a second run while one is tracked as running —
with a per-pin opt-out and an optional cross-process (cross-window / cross-launcher)
lock.

## Finish Report (2026-06-25)

### Scope

VS Code extension TypeScript (`extension/src/**`) plus docs (`CHANGELOG.md`, a plan
written into the separate Saropa Contacts repo). No Flutter/Dart code. Section 5
(Flutter l10n) does not apply; the extension's own catalog (`en.json`) was updated.

### Defect

The four run-dispatch paths had no concurrency control:

- `Scheduler.fire` ran the pin every slot regardless of an in-flight run.
- `ChainRunner.runMatching` auto-ran a triggered pin with only a re-entrancy cooldown
  (storm guard), which does not cover a still-running prior invocation.
- `runPinsOnSave` dispatched on every save.
- `runPinCommand` (manual) launched on every click.

The process the extension tracks (`processRegistry`) already knew which background /
report runs were live, but nothing consulted it before starting another run. Terminal
and external-window runs are fire-and-forget and untracked, so they had no possible
guard at all.

### Change

Default behavior is now "one run at a time per pin," opt-out.

- **Model** (`model/pin.ts`): two top-level `Pin` fields (placed alongside `paused`
  because recipe pins have no `exec`): `allowConcurrent` (absent/false = block) and
  `lockName` (opt-in cross-process lock).
- **Pure decision** (`exec/concurrency.ts`): `isConcurrencyBlocked(allowConcurrent,
  running)` — the default-block rule, vscode-free so it is unit-testable.
- **Cross-process lock** (`exec/runLock.ts`): a JSON lock file under
  `<os-temp>/saropa-workspace-locks/<name>.lock`, keyed by name. A lock is HELD only
  while its holder PID is alive on this host (`process.kill(pid, 0)`); a same-host
  dead-PID record is stale and stolen by the next run, so a crash never wedges a pin.
  A record from another host is treated as held (cannot be liveness-checked). All
  writes are best-effort so locking can never break a run. The staleness rule
  (`isLockStale`) is pure and injected with `alive()` for testing.
- **Orchestration** (`exec/runner.ts`): `runBlockReason(pin)` returns `"running"`
  (in-process tracked run) | `"locked"` (live cross-process holder) | `undefined`, the
  single source all four paths consult. `blockReasonLabel` centralizes the localized
  reason phrase. Background and report runs `acquire` the lock after spawn (keyed to
  the child PID) and `release` it on exit; `lockName` is threaded through
  `runInBackground`, `runShellAction`, and `runShellToReport`.
- **Guard sites**: scheduler skips and advances the schedule (so it re-arms for the
  next slot rather than tight-looping on the now-past one); chain runner skips and logs
  before the cooldown check; run-on-save skips quietly with a channel line; manual run
  shows a warning toast — **Stop and re-run** / **Run anyway** / **Show output** for a
  same-window running pin, or **Run anyway** / **Show output** (naming the holder PID)
  for a foreign lock. A forced re-run (`runPinCommand(..., force=true)`) bypasses the
  guard; Stop-and-re-run waits for `processRegistry` to clear (bounded timeout) before
  relaunching.
- **UI** (`commands/configureRun.ts`, `model/pinStore.ts`): the Configure Run hub
  gained **Concurrent runs** (Block/Allow) and **Cross-process lock** (name) fields,
  persisted top-level via `store.setPinConcurrency` (a second mutate, since the fields
  do not live on `PinExecConfig`).
- **l10n** (`i18n/locales/en.json`): added the concurrency reason phrases, the
  schedule / chain / save skip lines, the manual-run toast strings, and the Configure
  Run field labels.

### Known limitation (by design)

The in-process guard can only observe runs the extension tracks — background and
report-capture runs. Integrated-terminal and external-window runs are fire-and-forget
(`engines.vscode` is `^1.74.0`; the Terminal Shell Integration API that could read a
terminal run's exit was finalized in 1.93), so `allowConcurrent` alone never blocks
them. Only a `lockName` guards those, and only against runs that also honor the same
lock. This is stated in the field doc comments and the CHANGELOG.

### Cross-project note (Saropa Contacts — no code touched there)

The NLLB script `setup_arb_translate.py` was found to already self-lock
(`<project_root>/tmp/setup_arb_translate.lock`, exclusive-create, `LOCK_HELD` exit
code 2, stale detection), so a double run was already refused regardless of launcher.
A plan (`plans/PLAN_NLLB_LOCK_INTEROP.md`) was written into that repo documenting the
convention mismatch and the optional interop fix (the script also honoring the shared
temp-dir lock under name `nllb-gpu`). The Contacts owner has since implemented that
shared lock; the Workspace side here is unchanged by it.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.test.js` — 163 tests pass (9 new: the default-block rule, the
  staleness rule including the cross-host case, and the lock-file round-trip including
  dead-PID steal and non-holder release).
- `en.json` parses as valid JSON; `node esbuild.js` builds the bundle.

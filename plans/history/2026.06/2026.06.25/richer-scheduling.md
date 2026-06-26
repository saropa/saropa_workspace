# Richer scheduling

Roadmap: Later / Exploratory. Day-of-week has shipped; this covers what remains.

## Verified current state

`PinSchedule` (`pin.ts:152-169`) supports `atTime` ("HH:mm"), `days[]` (weekday
constraint, **shipped**), `everyMs` (interval), `enabled`, and `lastRun` (reopen dedup).
`scheduler.ts` arms one in-process `setTimeout` per enabled pin, chaining via
`MAX_TIMEOUT` for far-future fires; `schedule.ts` `nextOccurrence` computes the next
fire (earlier of daily-time and interval). `configureSchedule.ts` offers interval
presets + a custom interval + weekday multi-select.

Not present: **cron expressions**, a **friendly cron/interval builder** beyond the
current presets, and **run-on-startup** triggers.

## Remaining work

1. **Cron expressions (5-field).** Add an optional `cron?: string` to `PinSchedule`
   (extend the existing struct — do not add a parallel schedule type). Parse + compute
   next-fire in `schedule.ts` so `nextOccurrence` handles cron alongside `atTime` /
   `everyMs`. Evaluate a small, dependency-free cron parser vs. a vetted library
   (blast-radius: a new dep needs sign-off; prefer an in-repo parser for a 5-field
   subset to avoid the supply-chain commitment).
2. **Friendly builder.** Raw cron is a known user barrier (competitive note). Add a
   QuickPick-driven builder that composes common schedules ("every weekday at 9",
   "every 30 min during work hours", "1st of the month") and emits the cron/interval
   under the hood — the user never types raw cron unless they choose the "advanced"
   path. Extends the existing `configureSchedule.ts` hub, not a new command.
3. **Run-on-startup.** Add `runOnStartup?: boolean` to `PinSchedule`. On `activate()`,
   after the store loads, fire startup pins once with a visible outcome — but respect
   the activation rule (no eager heavy work in the activation path): defer the run to
   after activation completes, and gate behind the same `enabled` flag. De-dup so a
   reload within a session does not re-fire (reuse `lastRun` semantics).

## Approach

- Every addition extends `PinSchedule` and flows through the one `nextOccurrence`
  function — single source of truth for fire timing. No second scheduler.
- The in-process timer model has known limits (no fire while VS Code is closed); the
  builder presets are validated against those limits and the UI does not promise
  while-closed execution.
- New strings via `l10n()`; the startup-run toast names the pin.

## Acceptance criteria

- A pin can carry a 5-field cron schedule that fires at the correct next occurrence,
  computed by the same `nextOccurrence` path as `atTime` / `everyMs`.
- The builder produces valid schedules without the user typing raw cron.
- Run-on-startup fires once per session after activation with a visible outcome, gated
  by `enabled`, de-duplicated on reload.

## Dependencies

- None blocking. A cron-parser dependency, if chosen over an in-repo parser, needs
  blast-radius sign-off. Tests depend on Phase 4.1 (cron next-fire is prime unit-test
  material).

## Implemented (2026-06-25)

All three remaining items shipped; the plan is complete.

- **Cron expressions.** `cron?: string` added to `PinSchedule` (`pin.ts`). An in-repo,
  dependency-free 5-field parser (`parseCron`) and next-fire computer (`nextCron`) live
  in `schedule.ts` and feed the same `nextOccurrence` path as `atTime` / `everyMs` — the
  earliest set slot wins. Supports `*`, lists, ranges, steps (`*/n`, `a-b/n`, `a/n`),
  3-letter month/day names, DOW `0`/`7` = Sunday, and Vixie's day-of-month OR
  day-of-week rule. A malformed expression disables the slot. Reopen de-dup mirrors the
  daily slot (current minute is a live catch-up candidate; an already-fired minute is
  skipped). The chosen in-repo parser avoids the supply-chain commitment, as the plan
  preferred.
- **Friendly builder.** `configureSchedule.ts` gains a **Cron schedule** row whose
  builder composes common schedules (every weekday at a time, every day at a time, a
  weekday each week, the 1st of the month, every N minutes during work hours, hourly)
  and emits the cron under the hood. Raw cron is only ever typed via the explicit
  **Advanced** path, which validates with `parseCron` before it can be saved.
- **Run-on-startup.** `runOnStartup?: boolean` added to `PinSchedule`, toggled from the
  same hub. `Scheduler.runStartupPins()` (called from `activate()` after the store
  loads) fires startup pins once, deferred `STARTUP_RUN_DELAY_MS` past activation, gated
  by `enabled`, and de-duped on `lastRun` within `STARTUP_DEDUP_MS` so a reload storm
  does not re-run them. A startup-only schedule (no time fields) is valid.

Verification: the pure cron math was checked against 25 next-fire / parser cases (all
pass); the bundle builds clean. The pre-existing type errors in `configureTriggers.ts` /
`plannerPanel.ts` / the `ChainRunner` call are from a separate in-flight idle-trigger
change, not this work.

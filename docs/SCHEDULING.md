# Scheduling

A shortcut can run on a schedule: a daily time, a repeating interval, or both.
Set it from a shortcut's context menu with **Configure Schedule…**.

## What you can set

- **Daily time (`atTime`)** — a 24-hour `HH:mm`. The shortcut fires once at that
  local time each day.
- **Repeat interval (`everyMs`)** — fire every N minutes. Set it from the
  Configure Schedule flow (entered in minutes).
- **Enabled** — a master on/off. Disabling stops the shortcut's timer
  immediately; re-enabling restarts it without a window reload.

A daily time and an interval may be combined.

## What happens on a fire

Each scheduled run is visible — nothing executes silently:

- A toast names the shortcut and the action.
- A timestamped line is written to the output channel with the command that ran
  (reveal it with **Show Output**).
- The fire time is recorded (`lastRun`) so reopening VS Code within the same
  target minute does not double-fire.

The tree shows each scheduled shortcut's **next run** as an inline badge and in
its tooltip. The status bar shows the soonest upcoming run across all enabled
schedules; click it to reveal that shortcut in the tree. When no shortcut has an
enabled schedule, the status-bar item is hidden.

## Background vs terminal runs

A scheduled shortcut runs through its normal run configuration. A background run
can be stopped from the tree (**Stop**), and its outcome (success/failure,
duration) shows as a status badge. An integrated-terminal run stays managed by the
terminal.

## Interactive tokens are skipped

A scheduled run cannot answer prompts, so a shortcut whose command, arguments, or
working directory contains an interactive token (`${prompt:Label}` or
`${pick:a,b,c}`) is **skipped** when it would fire on a schedule, with a note in
the output channel. Use only non-interactive parameters for scheduled shortcuts.
See [RECIPES.md](RECIPES.md) for the token reference.

## Lifetime

All timers are cleared when the extension deactivates (on window close or
reload), so nothing leaks or outlives the session. They re-arm on the next
activation from the stored schedules.

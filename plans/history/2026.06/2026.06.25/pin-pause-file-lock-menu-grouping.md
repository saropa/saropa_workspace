# Pin pause, file read-only lock, and context-menu regrouping

The Pins view offered no way to suspend a pin's automatic execution without
deleting its schedule/triggers, no way to mark a pinned file read-only on disk,
and its right-click menu had accumulated collided `@`-orders and scattered,
unlabeled groups. This change adds a pause/unpause toggle (automation only), a
filesystem read-only lock toggle, and reorganizes the pin context menu into
logical, divider-separated sections.

## Scope

VS Code extension (TypeScript) under `extension/`, plus the root `CHANGELOG.md`.
No Flutter/Dart code. No dependency changes.

## What changed

### Pause / Unpause (suspend automation, keep the definition)

- `Pin` gains an optional `paused?: boolean` (`extension/src/model/pin.ts`).
  When set, every UNATTENDED runner skips the pin while its schedule/triggers are
  preserved verbatim; a manual run still executes.
- `PinStore.setPinPaused()` persists the flag through `mutatePin` (drops the field
  on unpause; no-ops on auto/recipe pins, which are recomputed, not stored).
- Automation gates added:
  - `Scheduler` (`exec/scheduler.ts`): `armPin` arms no timer for a paused pin;
    `fireStartupPins` skips it; `fire` re-checks `paused` (a timer armed before the
    pause survives until it pops).
  - `ChainRunner` (`exec/chainRunner.ts`): `runMatching` skips a paused pin before
    cooldown/interactive bookkeeping; `onPinCompleted` suppresses a paused pin's
    `emits`; `syncIdleThresholds` drops a paused pin's idle thresholds.
  - Run-on-save (`extension.ts` `runPinsOnSave`): paused pins are not launched.
- Tree rendering (`views/pinTreeItem.ts`): a paused stored pin's `contextValue`
  gains a `Paused` suffix (`pinPaused` / `pinScheduledPaused`), the row shows a
  `paused` badge instead of a next-run time, the icon renders muted
  (`disabledForeground`), and a hover line explains what is suspended.
- Commands `saropaWorkspace.pausePin` / `saropaWorkspace.unpausePin` registered in
  `commands/pinCommands.ts`; each names the pin in its toast.

### File read-only lock

- `fileOps.toggleFileLock()` flips the target file's owner-write bit via
  `fs.chmod` — on Windows Node maps clearing owner-write to the read-only file
  attribute; on POSIX it flips the write bits, preserving group/other bits. The
  lock state is an OS attribute read live (not stored on the pin), so a single
  toggle is used and the toast names the file and the resulting state. A non-file
  pin is rejected with the same naming message the other file ops use.
- Command `saropaWorkspace.toggleFileLock` registered alongside the file ops.

### Context-menu regrouping

`package.json` `view/item/context` rewritten into ordered, divider-separated
groups: `1_run` (open/run/run-now/run-last/stop/force-kill/peek/simulate/output/
diff), `2_config` (configure run/schedule/triggers, pause/unpause, appearance,
metric, tail, tag, branch link, expiry), `3_edit` (rename, promote, new routine,
template, workspace-pin submenu), `4_file` (new/duplicate/rename/copy/lock/delete),
`5_copy` (path, link), `6_annotate` (comment, separator). Prior `@`-order
collisions (e.g. `setMetric` and the expiry submenu both at `2_edit@8`,
`renamePin` and `configureAppearance` both at `2_edit@4`) are removed. Config-group
when-clauses were converted from exact `viewItem == pin || viewItem == pinScheduled`
matches to the regex `/^pin(Scheduled)?(Paused)?$/` (and `/^pin(Scheduled|Auto)?(Paused)?$/`
where auto pins are included) so a paused pin keeps every action despite its suffix.

## Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm test` (`node --test`) — 154 pass, 0 fail.
- `node -e JSON.parse(...)` over `package.json`, `package.nls.json`,
  `src/i18n/locales/en.json` — all valid.

The pause/lock guards live in vscode-importing modules with no pure-logic seam, so
they are not covered by the `node --test` suite and were validated by inspection;
the regex when-clauses were validated against the full `contextValue` set
(`pin`, `pinScheduled`, `pinPaused`, `pinScheduledPaused`, `pinAuto`, `pinRecipe`,
`pinRecipeScheduled`, `pinRunning`, `pinStopping`).

## Localization

New runtime keys added to `src/i18n/locales/en.json` (`pause.treeBadge`,
`pause.tooltip`, `pause.paused`, `pause.unpaused`, `fileOps.locked`,
`fileOps.unlocked`, `fileOps.lockFailed`) and manifest titles to
`package.nls.json` (`command.toggleFileLock.title`, `command.pausePin.title`,
`command.unpausePin.title`). No machine-translation pipeline in this repo.

## Follow-ups / not done

- Pause/Unpause are context-menu only (no inline row button), by design, to avoid
  crowding the inline run/unpin icons.
- The file lock is a single toggle (the OS attribute is read live); there is no
  per-row lock indicator in the tree, since that would require stat-ing every file
  on each refresh.

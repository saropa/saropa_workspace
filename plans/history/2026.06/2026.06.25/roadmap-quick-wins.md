# Roadmap quick wins

Four low-risk roadmap items were implemented together: a "Run now" relabel on
scheduled pins, shebang-aware execution for extensionless scripts, completion of
the missing-pin fix with a Relocate action, and a per-pin lifetime run count in
the pin tooltip. None changes an existing run path's behavior; the work is menu
wiring, one new run-config resolution branch, one store method, and two display
additions.

## Finish Report (2026-06-25)

### Scope

VS Code extension only (`extension/`, TypeScript). No Dart/Flutter code, no
dependency changes. Four roadmap items, each previously listed under Phase 3.3 or
Later / Exploratory.

### Item 1 — "Run now" relabel on scheduled pins

A pin that carries a schedule now shows **Run now** in its right-click menu instead
of the generic **Run**, so firing a job ahead of its next timer reads as
intentional. The run path is unchanged — `runPinNow` delegates to the same
`runPinCommand` as `runPin`.

Mechanism: `PinTreeItem` appends a `Scheduled` suffix to the contextValue of a
resting pin whose `schedule` is defined (`pinScheduled` for an explicit pin,
`pinRecipeScheduled` for a recipe). The suffix preserves the `/^pin/` prefix, so
the generic run/open/unpin clauses keep matching; the exact-match menu clauses were
widened to accept it:

- `configureRun` / `configureSchedule` / `configureAppearance`: `viewItem == pin`
  → `(viewItem == pin || viewItem == pinScheduled)`.
- `promoteRecipe` (two entries): `viewItem == pinRecipe` →
  `(viewItem == pinRecipe || viewItem == pinRecipeScheduled)`.
- `peekPin` and the Workspace-Pin submenu excluded recipes with
  `viewItem != pinRecipe`; widened to `!(viewItem =~ /^pinRecipe/)` so a scheduled
  recipe is excluded too.
- The context-menu `runPin` entry gained `&& !(viewItem =~ /Scheduled$/)`; a new
  `runPinNow` entry shows on `viewItem =~ /Scheduled$/`. The inline play button is
  left as `runPin` for all pins (icon only; same handler).

Files: `views/pinTreeItem.ts`, `commands/pinCommands.ts`, `package.json` (command
+ menus + commandPalette guard), `package.nls.json` (`command.runPinNow.title`).

### Item 2 — Shebang-aware execution

When a pin has no explicit command prefix and its extension has no configured
default interpreter, the runner now reads the file's `#!` shebang and runs the
script through that interpreter instead of relying on the executable bit. A
`#!/usr/bin/env X` form yields `X`; any other shebang yields its literal
interpreter + args; a file with no shebang still runs directly (empty prefix).

`shebangInterpreter()` reads only the first 256 bytes (the shebang is line one) via
`fs.openSync`/`readSync`, wrapped in try/catch so a missing/unreadable file yields
no interpreter. It is consulted by both `resolveCommandPrefix` (last fallback) and
`isRunnable` (an extensionless shebang script is now runnable). Both are called only
for file pins, after the explicit-command and extension-default short-circuits, so
the read is skipped in the common case.

Files: `exec/runner.ts`.

### Item 3 — Relocate completes the missing-pin fix

The deleted-target flag (warning glyph, "file not found" hover) and the
click-to-fix dialog (Unpin / Show in Folder) already shipped. This adds the
**Relocate...** option to that dialog: it opens a file picker and re-points the pin
at the chosen file, preserving the pin's id, run config, schedule, and icon.

`PinStore.updatePinPath(pin, uri)` writes the new path via the existing `mutatePin`
helper — absolute for a global pin, folder-relative for a project pin. A project
pin pointed at a file outside its owning workspace folder is rejected (returns
`false`), because a folder-relative path cannot reach a sibling folder; the command
then tells the user to pin globally instead.

Files: `model/pinStore.ts`, `commands/pinCommands.ts`, `i18n/locales/en.json`
(`pin.missing.relocate`, `pin.missing.relocateOpenLabel`,
`pin.missing.relocateTitle`, `pin.relocated`, `pin.relocateOutsideFolder`).

### Item 4 — Lifetime run count in the tooltip

Each pin's tooltip gains a line with its lifetime run count, reusing the count the
telemetry store already keeps (no new collection path). The provider passes
`telemetry.count(pinId)` only when telemetry is enabled, otherwise 0; `PinTreeItem`
shows the line only when the count is greater than zero, so a never-run or
telemetry-off pin shows nothing.

Files: `views/pinTreeItem.ts` (new `runCount` constructor parameter + tooltip
line), `views/pinsTreeProvider.ts` (`runCount` helper threaded into both pin and
recent items), `i18n/locales/en.json` (`run.countTooltip`).

### Roadmap and changelog

`ROADMAP.md`: the three Later / Exploratory items ("Run now" on scheduled pins, Pin
health indicators, Shebang respect) were removed as shipped; the competitive-gaps
table row for shebang was updated to "Shipped". Phase 3.3 was updated to record the
tooltip run-count as shipped while leaving its remaining work — the on-demand
activity summary view (most-run pins, totals, success/failure split) — open and
unmarked.

`CHANGELOG.md` `[Unreleased]`: the existing deleted-file entry was extended to name
Relocate; new Added entries cover shebang execution and the tooltip run count; a
Changed entry covers the "Run now" relabel.

### Verification

- `npx tsc -p ./ --noEmit` — exit 0.
- `node esbuild.js` — bundle built, exit 0.
- No automated tests exist in the repository (Phase 4.1 unit tests are still open;
  `npm test` references a runner with no spec sources). Standing up the test harness
  is net-new infrastructure outside the scope of these changes. Behavior was
  verified by type-check, bundle, and inspection; the menu when-clauses are
  validated by VS Code at runtime, not by the type-checker.

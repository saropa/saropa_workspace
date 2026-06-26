# Plan — #24 Live Metric Badges (The File-Size Watcher)

## Pain
Optimizing a bundle / shrinking a Docker image / watching a dump file means switching to
a terminal and typing `ls -lh` over and over.

## Target behavior
A file pin can carry a **live metric** — file size, line count, or last-modified — shown
as an inline badge that updates as the file changes (`bundle.js  [245 KB]`). An optional
threshold turns the badge red when crossed.

## Approach
### Model (`model/pin.ts`)
Add `Pin.metric?: { kind: "size" | "lines" | "modified"; thresholdBytes?: number }`.

### Metric engine (`exec/metricBadges.ts`, new)
- Singleton with a `Map<pinId, { text: string; over: boolean }>` cache and an
  `onDidChange` event.
- `track(pins)` reconciles which metric'd pins need a `FileSystemWatcher` on their
  resolved path; on change (and once on track) it `stat`s the file (size/mtime) or reads
  it (line count — guard with a max-size cap to avoid reading a huge file for line
  counting; fall back to size when too big) and updates the cache, firing `onDidChange`.
- Formatting: human-readable bytes (KB/MB), `N lines`, relative time for modified.
- Threshold: `over = thresholdBytes != null && bytes > thresholdBytes`.

### Tree integration (`views/pinsTreeProvider.ts` + `views/pinTreeItem.ts`)
- Provider subscribes to `metricBadges.onDidChange` → repaint; calls `metricBadges.track`
  on store change; passes the cached badge into the pin item.
- `PinTreeItem` appends the badge to its `description` and, when `over`, renders the icon
  in a warning color (`ThemeColor("list.warningForeground")` / `charts.red`) — color the
  **icon**, since a TreeItem description cannot be individually colored.

### Config
- `saropaWorkspace.setMetric` command (or a **Live metric** field in
  `commands/configureRun.ts`): pick kind, optionally set a threshold; `store.setMetric`
  (`mutatePin`). A separate command avoids touching the hot `configureRun` hub.

## Files & changes
- `model/pin.ts` — `metric?` field.
- `model/pinStore.ts` — `setMetric`.
- `exec/metricBadges.ts` (new) — cache + watchers + formatting.
- `views/pinsTreeProvider.ts` — subscribe/track; pass badge to the item.
- `views/pinTreeItem.ts` — **constructor signature gains a metric param** (see risk).
- `commands/...` — `setMetric` command.
- `package.json` / nls / en.json — command, menu, strings.

## Deviations / limits
- "Updates in real-time" = on file-system change events, which fire promptly but are not
  a per-second poll; for a file written continuously this is effectively live.
- Line count requires reading the file; cap the size and degrade to size-only above the
  cap so a multi-GB dump is never fully read.

## Risks / blast radius
- `PinTreeItem`'s constructor already carries ~10 positional params and is edited by
  multiple workstreams. Adding an 11th is a **merge-collision hot spot**. Strongly prefer
  refactoring the constructor to an options object as a precursor, OR pass the badge via a
  narrow, well-named param appended last with a clear comment. Coordinate timing with
  whoever is editing `pinTreeItem.ts`.
- One `FileSystemWatcher` per metric'd pin — reconcile on change; dispose removed ones so
  watchers do not leak.

## Verification
`tsc` + `esbuild`; manual: set a size metric on a file, write to it, confirm the badge
updates; set a threshold below current size, confirm the icon goes red.

## Complexity & risk
Moderate complexity. Low functional risk (read-only), but real **integration** risk on
the shared `pinTreeItem` signature — sequence it when that file is quiet.

## Finish Report (2026-06-25)

Shipped as planned. A file pin can carry a live metric badge — file size, line count,
or last-modified — refreshed inline as the file changes on disk, with an optional size
threshold that turns the row's icon to a warning tint and fires a one-time toast when
the file grows past the limit.

### What landed
- **Model** (`model/pin.ts`): `PinMetric { kind: "size" | "lines" | "modified";
  thresholdBytes?: number }` and a `Pin.metric?` field. `thresholdBytes` is documented
  as size-kind-only.
- **Store** (`model/pinStore.ts`): `setPinMetric(pin, metric)` via the existing
  `mutatePin` path (no-ops on auto-pins, which cannot persist).
- **Engine** (`exec/metricBadges.ts`, new): a singleton registry with a per-pin badge
  cache, an `onDidChange` event, and `track(targets)` watcher reconciliation. Each
  metric'd pin gets one **non-recursive** `FileSystemWatcher` on its exact file
  (`RelativePattern(dir, basename)`, no `**`); change events are **debounced** (400 ms)
  before a measure; size/modified use a single `fs.stat`; line counting is **capped**
  at 5 MB and degrades to size above it. The threshold toast fires only on a fresh
  under→over crossing, and never on the first measure (so an already-over file shows
  the badge silently on open). Watchers are reconciled on every store change and
  disposed when a metric is removed; the engine is disposed on deactivation.
- **Pure helpers** (`exec/metricFormat.ts`, new): `formatBytes`, `countLines`,
  `parseSize` extracted vscode-free (mirroring `schedule.ts`) so they are unit-testable
  under the Node test runner. Consumed by the engine and the command.
- **Tree** (`views/pinsTreeProvider.ts`, `views/pinTreeItem.ts`): the provider builds
  metric targets from metric'd file pins, calls `metricBadges.track` on store change,
  repaints on the engine's event, and passes the cached badge into the item. The item
  renders the value as a trailing description segment ("modified" formatted relative at
  paint time so it never goes stale), tints the icon as a warning when over threshold,
  and adds a hover line. `metricBadge` was appended as the last positional constructor
  param (matching the prior `sweepBadge` addition) rather than refactoring the
  constructor to an options object.
- **Command** (`commands/setMetric.ts`, new): `saropaWorkspace.setMetric` — a QuickPick
  to choose the kind (or Off), then an optional human-entered size threshold
  (`250kb` / `5mb` / `1gb`, validated inline). Registered in `pinCommands.ts`; wired
  into `package.json` (command, the pin context menu `2_edit@8`, palette `when:false`),
  `package.nls.json`, and `i18n/locales/en.json`.

### Deviation from the plan
The plan listed an optional **Live metric** field inside `commands/configureRun.ts`;
the separate `saropaWorkspace.setMetric` command was chosen instead (the plan's stated
preference — it avoids touching the hot `configureRun` hub).

### Verification
`npx tsc -p ./ --noEmit` clean; `node esbuild.js` builds; both JSON manifests parse;
`npm test` green (30 tests: 19 schedule + 11 new `metricFormat`). Device/manual smoke
test of the live badge update and threshold toast is the user's to run (see handoff).

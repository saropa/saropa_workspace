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

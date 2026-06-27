import { Shortcut, shortcutKind } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { shortcutBadges } from "../exec/shortcutBadges";
import { metricBadges, MetricTarget } from "../exec/metricBadges";
import { dependencyState } from "../exec/dependencies";
import { telemetry, RunRecord } from "../exec/telemetry";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { ShortcutTreeItem } from "./shortcutTreeItem";

// The per-shortcut tree-row constructors and the data each row reads (run state,
// badges, metric, dependency lock, recent history). Split out of pinsTreeProvider so
// the provider keeps the tree shape (roots / groups / children, filtering, reveal) and
// these stateless builders — which need only the store plus the module-level run /
// badge / telemetry singletons — live on their own.

export function buildShortcutItem(
  store: ShortcutStore,
  shortcut: Shortcut
): ShortcutTreeItem {
  return new ShortcutTreeItem(
    shortcut,
    store.resolveUri(shortcut),
    processRegistry.isRunning(shortcut.id),
    runStatusRegistry.get(shortcut.id),
    processRegistry.isStopping(shortcut.id),
    undefined,
    store.isMissing(shortcut.id),
    runCount(shortcut.id),
    lockedBy(store, shortcut),
    shortcutBadges.get(shortcut.id),
    metricBadges.get(shortcut.id),
    // Untapped: never opened or run. Drives the leading dot that makes the activity-bar
    // count badge actionable (the badge counts exactly these). Recent entries below
    // never pass it — being in Recent means it has been tapped.
    !tappedShortcuts.has(shortcut.id)
  );
}

// A Recent-group entry: the same shortcut node, tagged with when/how it last ran.
export function buildRecentItem(
  store: ShortcutStore,
  shortcut: Shortcut,
  record: RunRecord
): ShortcutTreeItem {
  return new ShortcutTreeItem(
    shortcut,
    store.resolveUri(shortcut),
    processRegistry.isRunning(shortcut.id),
    runStatusRegistry.get(shortcut.id),
    processRegistry.isStopping(shortcut.id),
    { at: record.at, source: record.source, kind: record.kind },
    store.isMissing(shortcut.id),
    runCount(shortcut.id)
  );
}

// The display name of a shortcut's unmet run prerequisite (WOW #13), or undefined when
// the shortcut is cleared to run. The provider repaints on runStatusRegistry changes,
// so a shortcut unlocks the moment its prerequisite succeeds.
export function lockedBy(
  store: ShortcutStore,
  shortcut: Shortcut
): string | undefined {
  const { pendingDependencyId } = dependencyState(shortcut, (id) =>
    store.findShortcut(id)
  );
  if (!pendingDependencyId) {
    return undefined;
  }
  const dep = store.findShortcut(pendingDependencyId);
  return dep
    ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
    : pendingDependencyId;
}

// The lifetime run count to surface in a shortcut's tooltip — zero when telemetry is
// disabled, so a turned-off user sees no count (the data is left in place until
// they reset it, but it is not displayed).
export function runCount(pinId: string): number {
  return telemetry.enabled() ? telemetry.count(pinId) : 0;
}

// The recent run records that still resolve to a live shortcut (a removed/deleted
// shortcut is skipped, matching the palette). Empty when telemetry is disabled.
export function recentEntries(
  store: ShortcutStore
): { shortcut: Shortcut; record: RunRecord }[] {
  if (!telemetry.enabled()) {
    return [];
  }
  return telemetry
    .recent()
    .map((record) => {
      const shortcut = store.findShortcut(record.pinId);
      return shortcut ? { shortcut, record } : undefined;
    })
    .filter(
      (e): e is { shortcut: Shortcut; record: RunRecord } => e !== undefined
    );
}

// Reconcile the metric engine's file watchers (#24) against the current set of
// metric'd file shortcuts across both scopes. Only a file shortcut that carries a
// metric and resolves to a concrete URI is watched, so a workspace with no metric'd
// shortcuts arms no watchers at all. Cheap and idempotent: the engine keeps an
// unchanged target's live watcher untouched, so calling this on every store change
// costs nothing in the steady state.
export function syncMetrics(store: ShortcutStore): void {
  const targets: MetricTarget[] = [];
  for (const shortcut of [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ]) {
    if (!shortcut.metric || shortcutKind(shortcut) !== "file") {
      continue;
    }
    const uri = store.resolveUri(shortcut);
    if (!uri) {
      continue;
    }
    targets.push({
      pinId: shortcut.id,
      name: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
      uri,
      metric: shortcut.metric,
    });
  }
  metricBadges.track(targets);
}

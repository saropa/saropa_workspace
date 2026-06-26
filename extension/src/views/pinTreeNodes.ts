import { Pin, pinKind } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { pinBadges } from "../exec/pinBadges";
import { metricBadges, MetricTarget } from "../exec/metricBadges";
import { dependencyState } from "../exec/dependencies";
import { telemetry, RunRecord } from "../exec/telemetry";
import { PinTreeItem } from "./pinTreeItem";

// The per-pin tree-row constructors and the data each row reads (run state, badges,
// metric, dependency lock, recent history). Split out of pinsTreeProvider so the
// provider keeps the tree shape (roots / groups / children, filtering, reveal) and
// these stateless builders — which need only the store plus the module-level run /
// badge / telemetry singletons — live on their own.

export function buildPinItem(store: PinStore, pin: Pin): PinTreeItem {
  return new PinTreeItem(
    pin,
    store.resolveUri(pin),
    processRegistry.isRunning(pin.id),
    runStatusRegistry.get(pin.id),
    processRegistry.isStopping(pin.id),
    undefined,
    store.isMissing(pin.id),
    runCount(pin.id),
    lockedBy(store, pin),
    pinBadges.get(pin.id),
    metricBadges.get(pin.id)
  );
}

// A Recent-group entry: the same pin node, tagged with when/how it last ran.
export function buildRecentItem(
  store: PinStore,
  pin: Pin,
  record: RunRecord
): PinTreeItem {
  return new PinTreeItem(
    pin,
    store.resolveUri(pin),
    processRegistry.isRunning(pin.id),
    runStatusRegistry.get(pin.id),
    processRegistry.isStopping(pin.id),
    { at: record.at, source: record.source, kind: record.kind },
    store.isMissing(pin.id),
    runCount(pin.id)
  );
}

// The display name of a pin's unmet run prerequisite (WOW #13), or undefined when
// the pin is cleared to run. The provider repaints on runStatusRegistry changes, so
// a pin unlocks the moment its prerequisite succeeds.
export function lockedBy(store: PinStore, pin: Pin): string | undefined {
  const { pendingDependencyId } = dependencyState(pin, (id) => store.findPin(id));
  if (!pendingDependencyId) {
    return undefined;
  }
  const dep = store.findPin(pendingDependencyId);
  return dep
    ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
    : pendingDependencyId;
}

// The lifetime run count to surface in a pin's tooltip — zero when telemetry is
// disabled, so a turned-off user sees no count (the data is left in place until
// they reset it, but it is not displayed).
export function runCount(pinId: string): number {
  return telemetry.enabled() ? telemetry.count(pinId) : 0;
}

// The recent run records that still resolve to a live pin (an unpinned/deleted
// pin is skipped, matching the palette). Empty when telemetry is disabled.
export function recentEntries(
  store: PinStore
): { pin: Pin; record: RunRecord }[] {
  if (!telemetry.enabled()) {
    return [];
  }
  return telemetry
    .recent()
    .map((record) => {
      const pin = store.findPin(record.pinId);
      return pin ? { pin, record } : undefined;
    })
    .filter((e): e is { pin: Pin; record: RunRecord } => e !== undefined);
}

// Reconcile the metric engine's file watchers (#24) against the current set of
// metric'd file pins across both scopes. Only a file pin that carries a metric and
// resolves to a concrete URI is watched, so a workspace with no metric'd pins arms
// no watchers at all. Cheap and idempotent: the engine keeps an unchanged target's
// live watcher untouched, so calling this on every store change costs nothing in
// the steady state.
export function syncMetrics(store: PinStore): void {
  const targets: MetricTarget[] = [];
  for (const pin of [...store.getProjectPins(), ...store.getGlobalPins()]) {
    if (!pin.metric || pinKind(pin) !== "file") {
      continue;
    }
    const uri = store.resolveUri(pin);
    if (!uri) {
      continue;
    }
    targets.push({
      pinId: pin.id,
      name: pin.label ?? (pin.path.split("/").pop() ?? pin.path),
      uri,
      metric: pin.metric,
    });
  }
  metricBadges.track(targets);
}

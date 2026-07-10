import {
  ShortcutKind,
  shortcutKind,
  ShortcutSchedule,
  SystemEventName,
} from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { runStatusRegistry } from "../exec/runStatus";
import { isRunnable } from "../exec/runner";
import { l10n } from "../i18n/l10n";

// A single node in the planner's chain graph — either a shortcut ("pin", carrying its
// schedule/emits/runnable state for the inspector and timeline) or a synthesized
// system-event source node. The kind-specific fields stay optional on one flat shape
// rather than a discriminated union because the client script reads them positionally.
export interface PlannerNode {
  id: string;
  kind: "pin" | "event";
  label: string;
  // shortcut-only fields
  scope?: "project" | "global";
  shortcutKind?: ShortcutKind;
  // The recipe's own prose (what it does + what it was detected from), surfaced as
  // the detail strip's INFO tip so a seeded/paused recipe explains itself in place.
  description?: string;
  schedule?: ShortcutSchedule;
  emits?: SystemEventName[];
  runnable?: boolean;
  lastOutcome?: "success" | "failure";
  // event-only field
  event?: SystemEventName;
}

// A directed edge in the chain graph: `from` triggers `to`, either because a shortcut
// lists another shortcut as a trigger (kind "pin") or because it fires on a system event
// (kind "event", with `from` set to the matching synthesized `event:<name>` node id).
export interface PlannerEdge {
  from: string;
  to: string;
  kind: "pin" | "event";
}

// The full graph payload posted to the planner webview: every non-auto shortcut as a
// node plus the synthesized event nodes, and only the edges that survived the
// dangling-reference filter in buildData (a removed shortcut leaves no orphan arrow).
export interface PlannerData {
  nodes: PlannerNode[];
  edges: PlannerEdge[];
}

// Translate the stored shortcuts into the planner graph. Auto-shortcuts are excluded
// (they cannot carry a schedule or triggers). Event nodes are synthesized for every
// system event that some shortcut triggers on, so the graph can draw the source.
export function buildData(store: ShortcutStore): PlannerData {
  const shortcuts = [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ].filter((p) => !p.isAuto);

  const nodes: PlannerNode[] = [];
  const edges: PlannerEdge[] = [];
  const eventsUsed = new Set<SystemEventName>();

  for (const shortcut of shortcuts) {
    const result = runStatusRegistry.get(shortcut.id);
    const uri =
      shortcutKind(shortcut) === "file" ? store.resolveUri(shortcut) : undefined;
    nodes.push({
      id: shortcut.id,
      kind: "pin",
      label: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
      scope: shortcut.scope,
      shortcutKind: shortcutKind(shortcut),
      description: shortcut.description,
      schedule: shortcut.schedule,
      emits: shortcut.emits,
      runnable:
        shortcutKind(shortcut) !== "file" ||
        (uri ? isRunnable(shortcut, uri.fsPath) : false),
      lastOutcome: result?.outcome,
    });

    for (const trigger of shortcut.triggers ?? []) {
      if (trigger.kind === "pin") {
        edges.push({ from: trigger.pinId, to: shortcut.id, kind: "pin" });
      } else if (trigger.kind === "event") {
        eventsUsed.add(trigger.event);
        edges.push({
          from: `event:${trigger.event}`,
          to: shortcut.id,
          kind: "event",
        });
      }
      // An idle trigger has no source node (it fires from elapsed inactivity, not
      // from another shortcut or event), so it draws no edge in the chain graph.
    }
  }

  // Synthesize an event node for each event that is actually wired, so the edge
  // has a source to point from.
  for (const event of eventsUsed) {
    nodes.push({
      id: `event:${event}`,
      kind: "event",
      label: l10n(`chain.event.${event}`),
      event,
    });
  }

  // Drop edges whose source shortcut was removed (a dangling chain) so the graph
  // never draws an arrow from nothing.
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

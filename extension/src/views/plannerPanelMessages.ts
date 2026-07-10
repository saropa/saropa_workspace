import * as vscode from "vscode";
import { Shortcut, ShortcutSchedule, SystemEventName } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// Workspace-state key for the hand-arranged Workflow graph's node positions —
// written here by savePositions() (a user drag) and read by PlannerPanel.push()
// on every repaint so the layout survives across pushes and window reloads.
export const LAYOUT_KEY = "saropaWorkspace.planner.layout";

// Shared lookup for every message handler below: the webview posts back a bare
// shortcut id (or `undefined` for a stray/late message), so this centralizes the
// "no id, no shortcut" short-circuit instead of repeating the guard at each call site.
export function findStored(store: ShortcutStore, id: string | undefined): Shortcut | undefined {
  if (!id) {
    return undefined;
  }
  return store.findShortcut(id);
}

// Planner's "Run" gesture (double-click / context-menu on a node) — delegates to
// the same `saropaWorkspace.runPin` command the tree view uses, so run behavior
// (terminal vs background channel, working directory) stays identical across surfaces.
export async function runById(store: ShortcutStore, id?: string): Promise<void> {
  const shortcut = findStored(store, id);
  if (shortcut) {
    await vscode.commands.executeCommand("saropaWorkspace.runPin", shortcut);
  }
}

// Planner's "Open" gesture — mirrors runById() but for the single-click/open
// path, delegating to `saropaWorkspace.openPin` so the file opens the same way
// it would from the tree view.
export async function openById(store: ShortcutStore, id?: string): Promise<void> {
  const shortcut = findStored(store, id);
  if (shortcut) {
    await vscode.commands.executeCommand("saropaWorkspace.openPin", shortcut);
  }
}

// Generic dispatch for planner context-menu actions (edit, duplicate, delete, etc.)
// that need to run an arbitrary command against a shortcut and then force a
// repaint. Used instead of one-off handlers per command so adding a new context-menu
// action doesn't need a new message type.
export async function runCommandForShortcut(
  store: ShortcutStore,
  command: string,
  id: string | undefined,
  push: () => Promise<void>
): Promise<void> {
  const shortcut = findStored(store, id);
  if (shortcut) {
    await vscode.commands.executeCommand(command, shortcut);
    // The QuickPick editor wrote through the store, which fires onDidChange and
    // repaints; push() explicitly too in case nothing changed (the panel still
    // reflects the latest state).
    await push();
  }
}

// Toggle a shortcut's schedule enabled flag in place — the Pause / Resume gesture.
export async function toggleEnabled(store: ShortcutStore, id?: string): Promise<void> {
  const shortcut = findStored(store, id);
  if (!shortcut?.schedule) {
    return;
  }
  const resumed = !shortcut.schedule.enabled;
  await store.updateShortcutSchedule(shortcut, {
    ...shortcut.schedule,
    enabled: resumed,
  });
  // Name the shortcut and the new state — the strip's "(paused)" text also updates,
  // but a toast confirms the gesture took and which shortcut it acted on (no silent
  // async).
  const name = shortcut.label ?? shortcut.id;
  vscode.window.showInformationMessage(
    l10n(resumed ? "planner.scheduleResumed" : "planner.schedulePaused", { name })
  );
}

// Drag-retime from the Week view: set the daily time, and move the dragged
// weekday to the drop column. Moving onto a day already in the set just retimes;
// moving to a new day swaps the dragged day for the target so the gesture reads as
// "move this run to here". A shortcut with no day list (every day) keeps firing every
// day — only its time changes — because dragging one instance should not silently
// collapse an everyday schedule to a single day.
export async function retime(
  store: ShortcutStore,
  id?: string,
  atTime?: string,
  fromDay?: number,
  toDay?: number
): Promise<void> {
  const shortcut = findStored(store, id);
  if (!shortcut?.schedule || !atTime) {
    return;
  }
  const schedule: ShortcutSchedule = { ...shortcut.schedule, atTime };
  const hadDays = shortcut.schedule.days && shortcut.schedule.days.length > 0;
  if (
    hadDays &&
    fromDay !== undefined &&
    toDay !== undefined &&
    fromDay !== toDay
  ) {
    const set = new Set(shortcut.schedule.days);
    set.delete(fromDay);
    set.add(toDay);
    schedule.days = [...set].sort((a, b) => a - b);
  }
  await store.updateShortcutSchedule(shortcut, schedule);
}

// Add a trigger to the TARGET shortcut (`to`). A shortcut link records the source
// shortcut id; an event link records the event. Deduped so dragging the same link
// twice is a no-op, and a self-link (a guaranteed loop) is rejected.
export async function addTrigger(
  store: ShortcutStore,
  to?: string,
  kind?: "pin" | "event",
  from?: string,
  event?: SystemEventName
): Promise<void> {
  const target = findStored(store, to);
  if (!target) {
    return;
  }
  const triggers = target.triggers ? [...target.triggers] : [];
  if (kind === "pin") {
    if (!from || from === to) {
      return;
    }
    if (
      triggers.some((t) => t.kind === "pin" && t.pinId === from)
    ) {
      return;
    }
    triggers.push({ kind: "pin", pinId: from });
  } else if (kind === "event" && event) {
    if (triggers.some((t) => t.kind === "event" && t.event === event)) {
      return;
    }
    triggers.push({ kind: "event", event });
  } else {
    return;
  }
  await store.updateShortcutTriggers(target, triggers, target.emits);
  const targetName = target.label ?? target.id;
  vscode.window.showInformationMessage(
    l10n("planner.linked", { name: targetName })
  );
}

// Counterpart to addTrigger() — deletes a single edge (a pin link or an event
// link) from the target shortcut's trigger list. Silently no-ops on a missing
// target or an unset `from`, since a stale drag-disconnect message shouldn't surface an error.
export async function removeTrigger(store: ShortcutStore, to?: string, from?: string): Promise<void> {
  const target = findStored(store, to);
  if (!target?.triggers || from === undefined) {
    return;
  }
  // `from` is a shortcut id for a shortcut trigger, or an event id ("event:build")
  // for an event trigger. An idle trigger has no graph edge, so it can never be the
  // removal target — give it a sentinel that no `from` value matches, leaving it
  // untouched.
  const remaining = target.triggers.filter((t) => {
    const sourceId =
      t.kind === "pin"
        ? t.pinId
        : t.kind === "event"
          ? `event:${t.event}`
          : "idle";
    return sourceId !== from;
  });
  await store.updateShortcutTriggers(target, remaining, target.emits);
}

// Persist the Workflow graph's hand-arranged node positions after a user drag —
// see LAYOUT_KEY above for why this is workspace state rather than in the shortcut
// model itself. A missing `positions` payload (e.g. a drag that didn't move anything) is a no-op.
export async function savePositions(
  context: vscode.ExtensionContext,
  positions?: Record<string, { x: number; y: number }>
): Promise<void> {
  if (!positions) {
    return;
  }
  await context.workspaceState.update(LAYOUT_KEY, positions);
}

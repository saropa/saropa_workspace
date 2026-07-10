import * as vscode from "vscode";
import {
  Shortcut,
  ShortcutTrigger,
  SystemEventName,
  SYSTEM_EVENTS,
} from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { showHubQuickPick } from "./hubQuickPick";
import { l10n } from "../i18n/l10n";

// Configure Triggers (WOW: recipe chaining + special events). A hub-and-spoke
// QuickPick to set what auto-runs a shortcut beyond its schedule:
//   - "Run after a shortcut": when another shortcut completes (optionally only on success).
//   - "Run after an event": build / publish / git commit / git push.
//   - "Run when idle": after N minutes of no VS Code interaction (WOW #18), forced to
//     the background channel so an unattended run never hijacks the terminal.
//   - "This shortcut emits": mark this shortcut as a build / publish step, so its completion
//     fires that event for OTHER shortcuts to chain off.
// Edits accumulate in a working copy and are written on Save; Esc at the hub
// discards. Mirrors the Configure Schedule / Boot Sequence hub shape so the three
// automation editors feel the same.
//
// This is the QuickPick entry point; the Planner & Workflow webview drives the same
// store method (updateShortcutTriggers) for the visual graph editing.

interface WorkTriggers {
  triggers: ShortcutTrigger[];
  emits: SystemEventName[];
}

// "Configure Triggers" command entry point (recipe chaining + special events). Warns
// and exits for an auto-shortcut (nowhere to persist triggers); otherwise builds a
// working copy of the triggers/emits lists, loops the hub tracking the last-acted row
// so an add/remove/toggle does not bounce focus to the top, and persists both lists on
// Save. Also the QuickPick counterpart to the Planner & Workflow webview, which edits
// the same store method for the visual graph.
export async function configureTriggers(
  store: ShortcutStore,
  shortcut: Shortcut
): Promise<void> {
  if (shortcut.isAuto) {
    // Auto-shortcuts are recomputed each refresh and never stored, so a trigger cannot
    // persist on them — same constraint as scheduling.
    vscode.window.showWarningMessage(l10n("triggers.autoUnsupported"));
    return;
  }

  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const title = l10n("triggers.title", { name });

  const work: WorkTriggers = {
    triggers: shortcut.triggers ? shortcut.triggers.map((t) => ({ ...t })) : [],
    emits: shortcut.emits ? [...shortcut.emits] : [],
  };

  // Restore focus to the row the user last acted on so adding a trigger or
  // flipping the success gate does not bounce the selection back to the top of the
  // list on every re-render (the hub-and-spoke "menu reopens from the start" feel).
  let activeKey: { act: HubChoice["act"]; index?: number } | undefined;
  for (;;) {
    const choice = await showHub(store, shortcut, work, title, activeKey);
    if (!choice) {
      return; // Esc discards.
    }
    if (choice.act === "save") {
      break;
    }
    activeKey = { act: choice.act, index: choice.index };
    switch (choice.act) {
      case "addShortcut":
        await addShortcutTrigger(store, shortcut, work, title);
        break;
      case "addEvent":
        await addEventTrigger(work, title);
        break;
      case "addIdle":
        await addIdleTrigger(work, title);
        break;
      case "emits":
        await editEmits(work, title);
        break;
      case "removeTrigger":
        if (choice.index !== undefined) {
          work.triggers.splice(choice.index, 1);
        }
        break;
      case "toggleSuccess":
        if (choice.index !== undefined) {
          toggleOnlyOnSuccess(work.triggers[choice.index]);
        }
        break;
    }
  }

  await store.updateShortcutTriggers(
    shortcut,
    work.triggers.length > 0 ? work.triggers : undefined,
    work.emits.length > 0 ? work.emits : undefined
  );
  vscode.window.showInformationMessage(l10n("triggers.saved", { name }));
}

// Flip the onlyOnSuccess flag of a shortcut trigger in place (no-op for an event trigger,
// which has no success concept).
function toggleOnlyOnSuccess(trigger: ShortcutTrigger | undefined): void {
  if (trigger && trigger.kind === "pin") {
    trigger.onlyOnSuccess = !trigger.onlyOnSuccess;
  }
}

interface HubChoice {
  act:
    | "addShortcut"
    | "addEvent"
    | "addIdle"
    | "emits"
    | "removeTrigger"
    | "toggleSuccess"
    | "save"
    // The non-actionable empty-state hint row: selecting it just re-renders the
    // hub (the main loop has no case for it), so it never discards edits.
    | "noop";
  index?: number;
}

interface HubItem extends vscode.QuickPickItem {
  act: HubChoice["act"] | "noop";
  index?: number;
}

function separator(label: string): vscode.QuickPickItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

async function showHub(
  store: ShortcutStore,
  shortcut: Shortcut,
  work: WorkTriggers,
  title: string,
  activeKey?: { act: HubChoice["act"]; index?: number }
): Promise<HubChoice | undefined> {
  const rows: Array<HubItem | vscode.QuickPickItem> = [
    { act: "addShortcut", label: l10n("triggers.addPin") },
    { act: "addEvent", label: l10n("triggers.addEvent") },
    { act: "addIdle", label: l10n("triggers.addIdle") },
    {
      act: "emits",
      label: l10n("triggers.field.emits"),
      description:
        work.emits.length > 0
          ? work.emits.map((e) => l10n(`chain.event.${e}`)).join(", ")
          : l10n("triggers.emits.none"),
    },
    separator(l10n("triggers.listSeparator")),
  ];

  if (work.triggers.length === 0) {
    rows.push({ act: "noop", label: l10n("triggers.empty") });
  } else {
    work.triggers.forEach((trigger, index) => {
      rows.push({
        act: "removeTrigger",
        index,
        label: describeTrigger(store, trigger),
        description: l10n("triggers.removeHint"),
      });
      // A shortcut trigger gets a second row to toggle the success gate, so the whole
      // thing stays keyboard-drivable without a nested menu.
      if (trigger.kind === "pin") {
        rows.push({
          act: "toggleSuccess",
          index,
          label: trigger.onlyOnSuccess
            ? l10n("triggers.successOnly.on")
            : l10n("triggers.successOnly.off"),
        });
      }
    });
  }

  rows.push(
    separator(l10n("triggers.actionsSeparator")),
    { act: "save", label: l10n("triggers.save"), description: l10n("triggers.saveHint") }
  );

  // Find the row matching the last-acted key so focus stays on it across re-renders.
  // After a removal the indices shift, so a stale index simply finds nothing and
  // focus falls back to the top — acceptable for the rare remove-then-reopen case.
  const items = rows as HubItem[];
  const active = activeKey
    ? items.find(
        (row) => row.act === activeKey.act && row.index === activeKey.index
      )
    : undefined;
  const pick = await showHubQuickPick(items, {
    title,
    placeholder: l10n("triggers.hubPlaceholder"),
    active,
  });
  // Esc returns undefined (discard). The noop hint row returns its act so the main
  // loop re-renders without discarding (it has no case for "noop").
  if (!pick) {
    return undefined;
  }
  return { act: pick.act, index: pick.index };
}

// One-line description of a trigger for the hub list: "After Build", "On git push",
// or "When idle 3m".
function describeTrigger(store: ShortcutStore, trigger: ShortcutTrigger): string {
  if (trigger.kind === "event") {
    return l10n("triggers.row.event", {
      event: l10n(`chain.event.${trigger.event}`),
    });
  }
  if (trigger.kind === "idle") {
    return l10n("triggers.row.idle", { minutes: trigger.minutes });
  }
  const source = store.findShortcut(trigger.pinId);
  const name = source
    ? source.label ?? (source.path.split("/").pop() ?? source.path)
    : l10n("triggers.row.missingPin");
  return l10n("triggers.row.pin", { name });
}

// Pick another shortcut to run this one after. Excludes the shortcut itself (a self-trigger is
// a guaranteed loop) and any shortcut already linked.
async function addShortcutTrigger(
  store: ShortcutStore,
  shortcut: Shortcut,
  work: WorkTriggers,
  title: string
): Promise<void> {
  const linked = new Set(
    work.triggers
      .filter((t): t is Extract<ShortcutTrigger, { kind: "pin" }> => t.kind === "pin")
      .map((t) => t.pinId)
  );
  const candidates: Shortcut[] = [
    ...store.getProjectShortcuts(),
    ...store.getGlobalShortcuts(),
  ].filter((p) => p.id !== shortcut.id && !linked.has(p.id));
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(l10n("triggers.addPin.none"));
    return;
  }
  interface ShortcutItem extends vscode.QuickPickItem {
    shortcut: Shortcut;
  }
  const items: ShortcutItem[] = candidates.map((p) => ({
    label: p.label ?? (p.path.split("/").pop() ?? p.path),
    description:
      p.scope === "global" ? l10n("pin.group.global") : l10n("pin.group.project"),
    shortcut: p,
  }));
  const choice = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("triggers.addPin.placeholder"),
    ignoreFocusOut: true,
  });
  if (!choice) {
    return;
  }
  work.triggers.push({ kind: "pin", pinId: choice.shortcut.id });
}

// Pick a system event to run this shortcut after.
async function addEventTrigger(
  work: WorkTriggers,
  title: string
): Promise<void> {
  const existing = new Set(
    work.triggers
      .filter((t): t is Extract<ShortcutTrigger, { kind: "event" }> => t.kind === "event")
      .map((t) => t.event)
  );
  interface EventItem extends vscode.QuickPickItem {
    event: SystemEventName;
  }
  const items: EventItem[] = SYSTEM_EVENTS.filter((e) => !existing.has(e)).map(
    (e) => ({
      label: l10n(`triggers.event.${e}`),
      detail: l10n(`triggers.eventDetail.${e}`),
      event: e,
    })
  );
  if (items.length === 0) {
    vscode.window.showInformationMessage(l10n("triggers.addEvent.none"));
    return;
  }
  const choice = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("triggers.addEvent.placeholder"),
    ignoreFocusOut: true,
  });
  if (!choice) {
    return;
  }
  work.triggers.push({ kind: "event", event: choice.event });
}

// Set (or replace) the idle trigger: run this shortcut after N minutes of no VS Code
// interaction (WOW #18). At most one idle trigger per shortcut — two would run the shortcut twice
// in one idle period — so an existing one is replaced rather than stacked. The default
// seeds from the current value, else 3 minutes (the pitch's default coffee-break span).
async function addIdleTrigger(work: WorkTriggers, title: string): Promise<void> {
  const existing = work.triggers.find(
    (t): t is Extract<ShortcutTrigger, { kind: "idle" }> => t.kind === "idle"
  );
  const entered = await vscode.window.showInputBox({
    title,
    prompt: l10n("triggers.idle.prompt"),
    placeHolder: l10n("triggers.idle.placeholder"),
    value: String(existing?.minutes ?? 3),
    validateInput: (input) => {
      const minutes = Number(input.trim());
      if (!Number.isInteger(minutes) || minutes <= 0) {
        return l10n("triggers.idle.invalid");
      }
      return undefined;
    },
  });
  if (entered === undefined) {
    return;
  }
  const minutes = Number(entered.trim());
  // Drop any prior idle trigger, then add the new one, so the shortcut carries exactly one.
  work.triggers = work.triggers.filter((t) => t.kind !== "idle");
  work.triggers.push({ kind: "idle", minutes });
}

// Multi-select which system events this shortcut's completion emits (build / publish).
// gitCommit / gitPush are detected from the repo and are not emittable by a shortcut, so
// only build / publish are offered.
async function editEmits(work: WorkTriggers, title: string): Promise<void> {
  const current = new Set(work.emits);
  interface EmitItem extends vscode.QuickPickItem {
    event: SystemEventName;
  }
  const emittable: SystemEventName[] = ["build", "publish"];
  const items: EmitItem[] = emittable.map((e) => ({
    label: l10n(`triggers.event.${e}`),
    detail: l10n(`triggers.emitDetail.${e}`),
    event: e,
    picked: current.has(e),
  }));
  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title,
    placeHolder: l10n("triggers.emits.placeholder"),
    ignoreFocusOut: true,
  });
  if (picks === undefined) {
    return;
  }
  work.emits = picks.map((p) => p.event);
}

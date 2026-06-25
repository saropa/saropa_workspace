import * as vscode from "vscode";
import {
  Pin,
  PinTrigger,
  SystemEventName,
  SYSTEM_EVENTS,
} from "../model/pin";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// Configure Triggers (WOW: recipe chaining + special events). A hub-and-spoke
// QuickPick to set what auto-runs a pin beyond its schedule:
//   - "Run after a pin": when another pin completes (optionally only on success).
//   - "Run after an event": build / publish / git commit / git push.
//   - "This pin emits": mark this pin as a build / publish step, so its completion
//     fires that event for OTHER pins to chain off.
// Edits accumulate in a working copy and are written on Save; Esc at the hub
// discards. Mirrors the Configure Schedule / Boot Sequence hub shape so the three
// automation editors feel the same.
//
// This is the QuickPick entry point; the Planner & Workflow webview drives the same
// store method (updatePinTriggers) for the visual graph editing.

interface WorkTriggers {
  triggers: PinTrigger[];
  emits: SystemEventName[];
}

export async function configureTriggers(
  store: PinStore,
  pin: Pin
): Promise<void> {
  if (pin.isAuto) {
    // Auto-pins are recomputed each refresh and never stored, so a trigger cannot
    // persist on them — same constraint as scheduling.
    vscode.window.showWarningMessage(l10n("triggers.autoUnsupported"));
    return;
  }

  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const title = l10n("triggers.title", { name });

  const work: WorkTriggers = {
    triggers: pin.triggers ? pin.triggers.map((t) => ({ ...t })) : [],
    emits: pin.emits ? [...pin.emits] : [],
  };

  for (;;) {
    const choice = await showHub(store, pin, work, title);
    if (!choice) {
      return; // Esc discards.
    }
    if (choice.act === "save") {
      break;
    }
    switch (choice.act) {
      case "addPin":
        await addPinTrigger(store, pin, work, title);
        break;
      case "addEvent":
        await addEventTrigger(work, title);
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

  await store.updatePinTriggers(
    pin,
    work.triggers.length > 0 ? work.triggers : undefined,
    work.emits.length > 0 ? work.emits : undefined
  );
  vscode.window.showInformationMessage(l10n("triggers.saved", { name }));
}

// Flip the onlyOnSuccess flag of a pin trigger in place (no-op for an event trigger,
// which has no success concept).
function toggleOnlyOnSuccess(trigger: PinTrigger | undefined): void {
  if (trigger && trigger.kind === "pin") {
    trigger.onlyOnSuccess = !trigger.onlyOnSuccess;
  }
}

interface HubChoice {
  act:
    | "addPin"
    | "addEvent"
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
  store: PinStore,
  pin: Pin,
  work: WorkTriggers,
  title: string
): Promise<HubChoice | undefined> {
  const rows: Array<HubItem | vscode.QuickPickItem> = [
    { act: "addPin", label: l10n("triggers.addPin") },
    { act: "addEvent", label: l10n("triggers.addEvent") },
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
      // A pin trigger gets a second row to toggle the success gate, so the whole
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

  const pick = (await vscode.window.showQuickPick(rows as HubItem[], {
    title,
    placeHolder: l10n("triggers.hubPlaceholder"),
    ignoreFocusOut: true,
  })) as HubItem | undefined;
  // Esc returns undefined (discard). The noop hint row returns its act so the main
  // loop re-renders without discarding (it has no case for "noop").
  if (!pick) {
    return undefined;
  }
  return { act: pick.act, index: pick.index };
}

// One-line description of a trigger for the hub list: "After Build (deploy.sh)" or
// "On git push".
function describeTrigger(store: PinStore, trigger: PinTrigger): string {
  if (trigger.kind === "event") {
    return l10n("triggers.row.event", {
      event: l10n(`chain.event.${trigger.event}`),
    });
  }
  const source = store.findPin(trigger.pinId);
  const name = source
    ? source.label ?? (source.path.split("/").pop() ?? source.path)
    : l10n("triggers.row.missingPin");
  return l10n("triggers.row.pin", { name });
}

// Pick another pin to run this one after. Excludes the pin itself (a self-trigger is
// a guaranteed loop) and any pin already linked.
async function addPinTrigger(
  store: PinStore,
  pin: Pin,
  work: WorkTriggers,
  title: string
): Promise<void> {
  const linked = new Set(
    work.triggers
      .filter((t): t is Extract<PinTrigger, { kind: "pin" }> => t.kind === "pin")
      .map((t) => t.pinId)
  );
  const candidates: Pin[] = [
    ...store.getProjectPins(),
    ...store.getGlobalPins(),
  ].filter((p) => p.id !== pin.id && !linked.has(p.id));
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(l10n("triggers.addPin.none"));
    return;
  }
  interface PinItem extends vscode.QuickPickItem {
    pin: Pin;
  }
  const items: PinItem[] = candidates.map((p) => ({
    label: p.label ?? (p.path.split("/").pop() ?? p.path),
    description:
      p.scope === "global" ? l10n("pin.group.global") : l10n("pin.group.project"),
    pin: p,
  }));
  const choice = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("triggers.addPin.placeholder"),
    ignoreFocusOut: true,
  });
  if (!choice) {
    return;
  }
  work.triggers.push({ kind: "pin", pinId: choice.pin.id });
}

// Pick a system event to run this pin after.
async function addEventTrigger(
  work: WorkTriggers,
  title: string
): Promise<void> {
  const existing = new Set(
    work.triggers
      .filter((t): t is Extract<PinTrigger, { kind: "event" }> => t.kind === "event")
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

// Multi-select which system events this pin's completion emits (build / publish).
// gitCommit / gitPush are detected from the repo and are not emittable by a pin, so
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

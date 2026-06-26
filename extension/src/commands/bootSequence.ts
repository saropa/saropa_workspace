import * as vscode from "vscode";
import { Pin, pinKind } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { isRunnable, getOutputChannel } from "../exec/runner";
import { showHubQuickPick } from "./hubQuickPick";
import { l10n } from "../i18n/l10n";

// Workspace boot sequence (roadmap 3.1). A named, ordered set of existing pins
// that runs when the workspace opens, behind a one-time per-session confirm —
// one action restores a working context (open the key files, start the dev
// server) instead of repeating the same opens and runs every session.
//
// Storage: workspaceState (on-device, per-workspace, NOT synced), because a boot
// sequence is about THIS workspace's files and tasks. The sequence references
// existing pins by id; a member whose pin was since removed is skipped at run
// time, never blocking the rest.
//
// Safe execution (see the Principles): nothing runs silently. On open the user is
// asked once before any step runs; declining skips it for the session (a window
// reload is a new session and asks again). Each step runs through the normal Run
// path, so it surfaces the same visible outcome a manual run does, and a failed
// step does not abort the rest unless stop-on-error is enabled.

interface BootSequenceData {
  // Whether the sequence is offered on workspace open. Off by default: an empty
  // sequence does nothing, and a user opts in by enabling it once populated.
  enabled: boolean;
  // When true, a failed step halts the run; otherwise the run continues to the
  // next step (the default — one broken task should not block opening files).
  stopOnError: boolean;
  // Ordered pin ids. Order IS the run order; reordering rewrites this list.
  pinIds: string[];
}

const KEY = "saropaWorkspace.bootSequence";

function emptyData(): BootSequenceData {
  return { enabled: false, stopOnError: false, pinIds: [] };
}

class BootSequenceStore {
  // Set by activate(); until then read/write are inert no-ops, mirroring the
  // telemetry singleton so importing this module before activation is safe.
  private context: vscode.ExtensionContext | undefined;

  init(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  get(): BootSequenceData {
    const data = this.context?.workspaceState.get<BootSequenceData>(KEY);
    return {
      enabled: data?.enabled === true,
      stopOnError: data?.stopOnError === true,
      pinIds: Array.isArray(data?.pinIds) ? data.pinIds : [],
    };
  }

  async save(data: BootSequenceData): Promise<void> {
    await this.context?.workspaceState.update(KEY, data);
  }
}

// Module-level singleton: the activation trigger reads it, the configure UX
// writes it.
export const bootSequence = new BootSequenceStore();

// In-memory, per-session guard so the open-time offer is made at most once per
// window even if activation logic runs again. A reload starts a fresh process,
// so the offer returns next session — the intended "once per session" behavior.
let offeredThisSession = false;

// The display name for a pin, falling back to its file basename, then a clear
// "removed pin" marker when the id no longer resolves.
function nameFor(store: PinStore, pinId: string): string {
  const pin = store.findPin(pinId);
  if (!pin) {
    return l10n("boot.unknownPin");
  }
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// Offer to run the boot sequence on workspace open. No-op (no prompt) when the
// sequence is disabled or empty, so a user who has not opted in never sees it.
export async function maybeRunBootSequenceOnOpen(store: PinStore): Promise<void> {
  if (offeredThisSession) {
    return;
  }
  offeredThisSession = true;

  const data = bootSequence.get();
  if (!data.enabled || data.pinIds.length === 0) {
    return;
  }

  const run = l10n("boot.prompt.action");
  const configure = l10n("boot.prompt.configure");
  const choice = await vscode.window.showInformationMessage(
    l10n("boot.prompt", { count: data.pinIds.length }),
    run,
    configure
  );
  if (choice === run) {
    await runBootSequence(store);
  } else if (choice === configure) {
    await configureBootSequence(store);
  }
  // Any other answer (dismiss) skips the sequence for this session, as designed.
}

// Run the sequence in order. Each member runs through the normal Run command, so
// it reuses token resolution, missing-file handling, telemetry, and the per-run
// toast — a runnable pin runs, a non-runnable file pin opens, an action pin fires
// its action. A removed pin is logged and skipped; a step that throws is logged
// and, unless stop-on-error is set, the run continues.
export async function runBootSequence(store: PinStore): Promise<void> {
  const data = bootSequence.get();
  if (data.pinIds.length === 0) {
    vscode.window.showInformationMessage(l10n("boot.run.empty"));
    return;
  }

  const channel = getOutputChannel();
  const total = data.pinIds.length;
  channel.appendLine(l10n("boot.run.start", { count: total }));

  let ran = 0;
  for (let i = 0; i < total; i++) {
    const pinId = data.pinIds[i];
    const step = i + 1;
    // The loop bound guarantees an element here; the explicit guard satisfies the
    // strict index-access check without an assertion.
    if (pinId === undefined) {
      continue;
    }
    const pin = store.findPin(pinId);
    if (!pin) {
      channel.appendLine(l10n("boot.run.missing", { index: step }));
      continue;
    }
    channel.appendLine(
      l10n("boot.run.step", { index: step, total, name: nameFor(store, pinId) })
    );
    try {
      // Run command dispatch covers all pin kinds: a runnable file runs, a
      // non-runnable file opens, an action pin fires its action.
      await vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
      ran++;
    } catch (err) {
      channel.appendLine(
        l10n("boot.run.stepFailed", {
          index: step,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      if (data.stopOnError) {
        channel.appendLine(l10n("boot.run.stopped"));
        break;
      }
    }
  }

  vscode.window.showInformationMessage(l10n("boot.run.done", { ran, total }));
}

// Whether a pin would RUN (vs merely open) when included — used only to label a
// member in the configure UX so the user can see what each step will do.
function memberActionLabel(store: PinStore, pinId: string): string {
  const pin = store.findPin(pinId);
  if (!pin) {
    return l10n("boot.member.actionMissing");
  }
  if (pinKind(pin) !== "file") {
    return l10n("boot.member.actionRun");
  }
  const uri = store.resolveUri(pin);
  return uri && isRunnable(pin, uri.fsPath)
    ? l10n("boot.member.actionRun")
    : l10n("boot.member.actionOpen");
}

// Hub QuickPick to define, reorder, and enable/disable the sequence — the same
// hub-and-spoke shape as Configure Run. Loops until the user picks Done or Esc;
// every change is persisted immediately so an Esc never loses edits.
export async function configureBootSequence(store: PinStore): Promise<void> {
  // Keep focus on the row the user last acted on, so adding a step or toggling a
  // flag does not reset the selection to the top of the list on every re-render.
  let activeKey: { act: HubItem["act"]; pinId?: string } | undefined;
  for (;;) {
    const data = bootSequence.get();
    const choice = await showHub(store, data, activeKey);
    if (!choice) {
      return;
    }
    if (choice.act === "done") {
      vscode.window.showInformationMessage(
        l10n("boot.saved", { count: data.pinIds.length })
      );
      return;
    }
    activeKey = { act: choice.act, pinId: choice.pinId };
    if (choice.act === "enabled") {
      await bootSequence.save({ ...data, enabled: !data.enabled });
    } else if (choice.act === "stopOnError") {
      await bootSequence.save({ ...data, stopOnError: !data.stopOnError });
    } else if (choice.act === "add") {
      await addMembers(store, data);
    } else if (choice.act === "run") {
      await runBootSequence(store);
    } else if (choice.act === "member" && choice.pinId) {
      await editMember(store, data, choice.pinId);
    }
  }
}

// `act` is the discriminant (the QuickPickItem already owns `kind`, used for
// separators). "noop" is the non-actionable empty-state hint; selecting it just
// re-renders.
interface HubItem extends vscode.QuickPickItem {
  act: "enabled" | "stopOnError" | "add" | "member" | "run" | "done" | "noop";
  pinId?: string;
}

// A non-selectable separator row, typed so it can sit in the same array as the
// HubItems without weakening their type.
function separator(label: string): vscode.QuickPickItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

async function showHub(
  store: PinStore,
  data: BootSequenceData,
  activeKey?: { act: HubItem["act"]; pinId?: string }
): Promise<{ act: HubItem["act"]; pinId?: string } | undefined> {
  const onOff = (on: boolean): string =>
    on ? l10n("boot.value.on") : l10n("boot.value.off");

  const rows: Array<HubItem | vscode.QuickPickItem> = [
    { act: "enabled", label: l10n("boot.field.enabled"), description: onOff(data.enabled) },
    {
      act: "stopOnError",
      label: l10n("boot.field.stopOnError"),
      description: onOff(data.stopOnError),
    },
    { act: "add", label: l10n("boot.add") },
    separator(l10n("boot.stepsSeparator")),
  ];

  if (data.pinIds.length === 0) {
    rows.push({ act: "noop", label: l10n("boot.empty") });
  } else {
    data.pinIds.forEach((pinId, index) => {
      rows.push({
        act: "member",
        pinId,
        label: `${index + 1}. ${nameFor(store, pinId)}`,
        description: memberActionLabel(store, pinId),
      });
    });
  }

  rows.push(
    separator(l10n("boot.actionsSeparator")),
    { act: "run", label: l10n("boot.run") },
    { act: "done", label: l10n("boot.done") }
  );

  // Separators are non-selectable, so the picker only ever returns a HubItem.
  // Restore focus to the last-acted row (matched by act + pinId for a member step).
  const items = rows as HubItem[];
  const active = activeKey
    ? items.find(
        (row) => row.act === activeKey.act && row.pinId === activeKey.pinId
      )
    : undefined;
  const pick = await showHubQuickPick(items, {
    title: l10n("boot.configure.title"),
    placeholder: l10n("boot.configure.placeholder"),
    active,
  });
  if (!pick) {
    return undefined;
  }
  return { act: pick.act, pinId: pick.pinId };
}

// Multi-select picker of pins not already in the sequence; the chosen pins are
// appended in the order the list presents them.
async function addMembers(
  store: PinStore,
  data: BootSequenceData
): Promise<void> {
  const existing = new Set(data.pinIds);
  const candidates: Pin[] = [
    ...store.getProjectPins(),
    ...store.getGlobalPins(),
  ].filter((p) => !existing.has(p.id));
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(l10n("boot.add.none"));
    return;
  }

  interface PinItem extends vscode.QuickPickItem {
    pin: Pin;
  }
  const items: PinItem[] = candidates.map((p) => ({
    label: p.label ?? (p.path.split("/").pop() ?? p.path),
    description: p.scope === "global" ? l10n("pin.group.global") : l10n("pin.group.project"),
    pin: p,
  }));
  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: l10n("boot.configure.title"),
    placeHolder: l10n("boot.add.placeholder"),
    ignoreFocusOut: true,
  });
  if (!picks || picks.length === 0) {
    return;
  }
  await bootSequence.save({
    ...data,
    pinIds: [...data.pinIds, ...picks.map((i) => i.pin.id)],
  });
}

// Per-member action menu: move the step up or down, or remove it.
async function editMember(
  store: PinStore,
  data: BootSequenceData,
  pinId: string
): Promise<void> {
  const index = data.pinIds.indexOf(pinId);
  if (index === -1) {
    return;
  }
  interface MemberAction extends vscode.QuickPickItem {
    action: "up" | "down" | "remove";
  }
  const actions: MemberAction[] = [];
  if (index > 0) {
    actions.push({ action: "up", label: l10n("boot.member.moveUp") });
  }
  if (index < data.pinIds.length - 1) {
    actions.push({ action: "down", label: l10n("boot.member.moveDown") });
  }
  actions.push({ action: "remove", label: l10n("boot.member.remove") });

  const pick = await vscode.window.showQuickPick(actions, {
    title: l10n("boot.configure.title"),
    placeHolder: l10n("boot.member.placeholder", { name: nameFor(store, pinId) }),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }

  const ids = [...data.pinIds];
  if (pick.action === "remove") {
    ids.splice(index, 1);
  } else {
    // Swap with the adjacent step in the chosen direction.
    const target = pick.action === "up" ? index - 1 : index + 1;
    [ids[index], ids[target]] = [ids[target], ids[index]];
  }
  await bootSequence.save({ ...data, pinIds: ids });
}

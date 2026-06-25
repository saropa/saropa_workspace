import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, PinScope } from "../model/pin";
import { PinFolderItem, PinGroupItem, PinTreeItem } from "../views/pinTreeItem";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { runPin as execRunPin, getOutputChannel, isRunnable } from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import { runStatusRegistry } from "../exec/runStatus";
import { recentRuns } from "../exec/recentRuns";
import {
  detectFavoritesFiles,
  importAllDetected,
  detectSiblingFavorites,
  importSiblingFavorites,
  SiblingFavorites,
} from "../import/favoritesImport";
import { configureRun } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { detectRunTargets, RunTarget } from "../exec/runTargets";
import { l10n } from "../i18n/l10n";

// Menu/command invocations hand us either a PinTreeItem (context menus, inline
// buttons) or a raw Pin (the click dispatcher). Normalize to a Pin.
function asPin(arg: unknown): Pin | undefined {
  if (arg instanceof PinTreeItem) {
    return arg.pin;
  }
  if (arg && typeof arg === "object" && "id" in arg && "scope" in arg) {
    return arg as Pin;
  }
  return undefined;
}

async function openPin(store: PinStore, pin: Pin): Promise<void> {
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

async function runPinCommand(store: PinStore, pin: Pin): Promise<void> {
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  // A pin with no way to execute (a text doc, markdown, image — anything without
  // an interpreter) should not be flung at the shell on a double-click. Open it
  // instead (opening is itself the visible feedback) and say why "run" did not
  // run, naming the file so the message ties to a concrete pin.
  if (!isRunnable(pin, uri.fsPath)) {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.window.showTextDocument(uri, { preview: false });
    vscode.window.showInformationMessage(l10n("run.openedNotRunnable", { name }));
    return;
  }
  await execRunPin(pin, uri);
}

async function pinUri(store: PinStore, uri: vscode.Uri, scope: PinScope): Promise<void> {
  const name = uri.path.split("/").pop() ?? uri.fsPath;
  const added = await store.addPin(uri, scope);
  if (added) {
    vscode.window.showInformationMessage(l10n("pin.added", { name }));
    // Offer inferred run targets (npm scripts, Make targets, a shebang) so the
    // pin runs the right thing without the user typing a command (7.5).
    await offerRunTarget(store, uri, scope, name);
  } else {
    vscode.window.showInformationMessage(l10n("pin.alreadyPinned", { name }));
  }
}

// After a file is pinned, detect run targets within it and, if any exist, let the
// user pick one to write as the pin's run config. Esc/dismiss leaves the pin with
// no run config (today's interpreter-default behavior) — the offer never blocks.
async function offerRunTarget(
  store: PinStore,
  uri: vscode.Uri,
  scope: PinScope,
  name: string
): Promise<void> {
  const targets = await detectRunTargets(uri);
  if (targets.length === 0) {
    return;
  }
  type TargetItem = vscode.QuickPickItem & { target: RunTarget };
  const items: TargetItem[] = targets.map((t) => ({
    label: t.label,
    detail: t.detail,
    target: t,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("runTarget.title", { name }),
    placeHolder: l10n("runTarget.placeholder"),
  });
  if (!pick) {
    return;
  }
  const pin = store.findPinByUri(uri, scope);
  if (!pin) {
    return;
  }
  await store.updatePinExec(pin, pick.target.exec);
  vscode.window.showInformationMessage(
    l10n("runTarget.applied", { name, target: pick.label.replace(/^\$\([^)]*\)\s*/, "") })
  );
}

function activeFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

// Number of generic "run top pin N" keybinding slots exposed (4.2).
const TOP_PIN_SLOTS = 5;

// The pins in tree order (project first, then global) — the order the "top pin N"
// keybindings and reorder-by-drag designate.
function orderedPins(store: PinStore): Pin[] {
  return [...store.getProjectPins(), ...store.getGlobalPins()];
}

// Run the Nth pin (1-based) for the runTopPinN keybindings.
function runTopPin(store: PinStore, slot: number): void {
  const pin = orderedPins(store)[slot - 1];
  if (pin) {
    void runPinCommand(store, pin);
  } else {
    vscode.window.showInformationMessage(l10n("runTop.noPin", { slot }));
  }
}

// Resolve a keybinding `args` reference to a pin: by id, then label, then full
// path, then basename. First match across project + global wins.
function resolvePinRef(store: PinStore, ref: unknown): Pin | undefined {
  if (typeof ref !== "string" || ref.trim() === "") {
    return undefined;
  }
  const needle = ref.trim();
  const pins = orderedPins(store);
  return (
    pins.find((p) => p.id === needle) ??
    pins.find((p) => p.label === needle) ??
    pins.find((p) => p.path === needle) ??
    pins.find((p) => (p.path.split("/").pop() ?? p.path) === needle)
  );
}

// Build the scope + group descriptor shown beside a pin in the Run Pin palette,
// so the same filename in two scopes/groups is distinguishable at a glance.
function pinLocation(store: PinStore, pin: Pin): string {
  const scope =
    pin.scope === "global"
      ? l10n("pin.group.global")
      : l10n("pin.group.project");
  if (!pin.groupId) {
    return scope;
  }
  const group = store.getGroups(pin.scope).find((g) => g.id === pin.groupId);
  return group ? `${scope} / ${group.label}` : scope;
}

// QuickPick over every pin across scopes and groups, recently-run ones first, to
// run one directly without opening the sidebar (4.1). Runs through the same
// runPinCommand path as the tree, so behavior is identical.
async function runAnyPin(store: PinStore): Promise<void> {
  const all = [...store.getProjectPins(), ...store.getGlobalPins()];
  if (all.length === 0) {
    vscode.window.showInformationMessage(l10n("runAny.empty"));
    return;
  }

  type PinItem = vscode.QuickPickItem & { pin?: Pin };
  const toItem = (pin: Pin): PinItem => ({
    label: pin.label ?? (pin.path.split("/").pop() ?? pin.path),
    description: pinLocation(store, pin),
    detail: pin.path,
    pin,
  });

  // Recents first (only ids that still resolve to a live pin), then a separator
  // and the full set ordered as the tree shows it.
  const recentPins = recentRuns
    .list()
    .map((id) => store.findPin(id))
    .filter((p): p is Pin => p !== undefined);

  const items: PinItem[] = [];
  if (recentPins.length > 0) {
    items.push({
      label: l10n("runAny.recent"),
      kind: vscode.QuickPickItemKind.Separator,
    });
    items.push(...recentPins.map(toItem));
    items.push({
      label: l10n("runAny.all"),
      kind: vscode.QuickPickItemKind.Separator,
    });
  }
  items.push(...all.map(toItem));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("runAny.placeholder"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (pick?.pin) {
    await runPinCommand(store, pick.pin);
  }
}

// The "New Group" action fires from the view title (no argument -> project, the
// repo-shared scope) or a scope root's context menu (a PinGroupItem carrying its
// scope). Default to project so a title-bar click has a defined home.
function scopeFromAddGroupArg(arg: unknown): PinScope {
  return arg instanceof PinGroupItem ? arg.group : "project";
}

export function registerPinCommands(
  context: vscode.ExtensionContext,
  store: PinStore,
  dispatcher: DoubleClickDispatcher
): void {
  const reg = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  reg("saropaWorkspace.refresh", () => store.refresh());

  reg("saropaWorkspace.runAnyPin", () => runAnyPin(store));

  // Bind a specific pin to a key. The keybinding's `args` is matched against a
  // pin's id, label, file path, or basename (in that order), so a user can bind
  // by a human-friendly reference instead of an opaque id:
  //   { "key": "...", "command": "saropaWorkspace.runPinById", "args": "deploy.sh" }
  reg("saropaWorkspace.runPinById", (ref: unknown) => {
    const pin = resolvePinRef(store, ref);
    if (pin) {
      void runPinCommand(store, pin);
    } else {
      vscode.window.showWarningMessage(l10n("runTop.notFound", { ref: String(ref) }));
    }
  });

  // Generic "run the Nth pin" commands, bindable without knowing any id. The Nth
  // pin is the Nth in the tree's order (project pins, then global) — reorder pins
  // by dragging to designate which are "top". One command per slot so each binds
  // to its own key.
  for (let slot = 1; slot <= TOP_PIN_SLOTS; slot++) {
    reg(`saropaWorkspace.runTopPin${slot}`, () => runTopPin(store, slot));
  }

  // Click dispatcher entry point: defer to single/double-click logic by pin id.
  reg("saropaWorkspace.activatePin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      dispatcher.activate(pin.id);
    }
  });

  reg("saropaWorkspace.openPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void openPin(store, pin);
    }
  });

  reg("saropaWorkspace.runPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      void runPinCommand(store, pin);
    }
  });

  reg("saropaWorkspace.renamePin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const current = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const label = await vscode.window.showInputBox({
      prompt: l10n("pin.renamePrompt", { name: current }),
      value: pin.label ?? "",
    });
    if (label !== undefined) {
      await store.renamePin(pin, label);
    }
  });

  reg("saropaWorkspace.configureRun", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureRun(store, pin);
    }
  });

  reg("saropaWorkspace.stopPin", (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const stopped = processRegistry.stop(pin.id);
    if (stopped) {
      // Reflect the stop in the output channel, distinct from a normal exit.
      getOutputChannel().appendLine(
        l10n("run.stopped", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.stopMessage", { name }));
    } else {
      vscode.window.showInformationMessage(l10n("run.notRunning", { name }));
    }
  });

  reg("saropaWorkspace.configureSchedule", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureSchedule(store, pin);
    }
  });

  reg("saropaWorkspace.unpin", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await store.removePin(pin);
    // Drop any last-run badge so it does not outlive the pin (the id is reused
    // for an identical re-pin only after a fresh run records a new result).
    runStatusRegistry.clear(pin.id);
    vscode.window.showInformationMessage(l10n("pin.removed", { name }));
  });

  // Reveal the shared output channel (background-run output, scheduled-run log,
  // and the "Show Output" target from a failed-run toast).
  reg("saropaWorkspace.showOutput", () => getOutputChannel().show(true));

  // Create a group in the project or global scope (see scopeFromAddGroupArg for
  // how the scope is resolved). Pins are dragged into it afterward.
  reg("saropaWorkspace.addGroup", async (arg: unknown) => {
    const scope = scopeFromAddGroupArg(arg);
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.addPrompt"),
      placeHolder: l10n("group.addPlaceholder"),
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label === undefined) {
      return;
    }
    const id = await store.createGroup(scope, label);
    if (id) {
      vscode.window.showInformationMessage(
        l10n("group.added", { name: label.trim() })
      );
    } else {
      // The only failure path for a non-empty label is a project group with no
      // workspace folder open; name that so the user knows why nothing changed.
      vscode.window.showWarningMessage(l10n("group.noWorkspace"));
    }
  });

  reg("saropaWorkspace.renameGroup", async (arg: unknown) => {
    if (!(arg instanceof PinFolderItem)) {
      return;
    }
    const label = await vscode.window.showInputBox({
      prompt: l10n("group.renamePrompt", { name: arg.pinGroup.label }),
      value: arg.pinGroup.label,
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("group.nameEmpty") : undefined,
    });
    if (label !== undefined) {
      await store.renameGroup(arg.pinGroup, arg.scope, label);
    }
  });

  reg("saropaWorkspace.deleteGroup", async (arg: unknown) => {
    if (!(arg instanceof PinFolderItem)) {
      return;
    }
    const name = arg.pinGroup.label;
    // Modal confirm: deletion is destructive to the grouping (not the pins,
    // which move to the top level), so it should be a deliberate choice.
    const confirm = l10n("group.deleteConfirmAction");
    const choice = await vscode.window.showWarningMessage(
      l10n("group.deleteConfirm", { name }),
      { modal: true },
      confirm
    );
    if (choice !== confirm) {
      return;
    }
    const reparented = await store.deleteGroup(arg.pinGroup, arg.scope);
    vscode.window.showInformationMessage(
      l10n("group.deleted", { name, count: reparented })
    );
  });

  reg("saropaWorkspace.pinActiveFile", () => {
    const uri = activeFileUri();
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "project");
  });

  reg("saropaWorkspace.pinActiveFileGlobal", () => {
    const uri = activeFileUri();
    if (!uri) {
      vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
      return;
    }
    void pinUri(store, uri, "global");
  });

  // Explorer context: VS Code passes (clickedUri, selectedUris[]).
  reg("saropaWorkspace.pinFile", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "project");
    }
  });

  reg("saropaWorkspace.pinFileGlobal", (uri: vscode.Uri) => {
    if (uri) {
      void pinUri(store, uri, "global");
    }
  });

  reg("saropaWorkspace.restoreAutoPins", async () => {
    const count = await store.restoreAutoPins();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("pin.autoRestored", { count })
        : l10n("pin.autoNoneRemoved")
    );
  });

  reg("saropaWorkspace.importFavorites", async () => {
    const detected = await detectFavoritesFiles();
    if (detected.length === 0) {
      vscode.window.showInformationMessage(l10n("import.none"));
      return;
    }
    const total = await importAllDetected(store);
    const fileList = detected.map((d) => d.fileName).join(", ");
    vscode.window.showInformationMessage(
      total > 0
        ? l10n("import.done", { count: total, file: fileList })
        : l10n("import.nothingNew", { file: fileList })
    );
  });

  // Scan immediate sibling projects (one directory level up) for favorites files
  // and import the user's selection as GLOBAL pins. Explicit and user-invoked, so
  // cross-project disk reads only happen on demand.
  reg("saropaWorkspace.scanSiblingFavorites", async () => {
    const found = await detectSiblingFavorites();
    if (found.length === 0) {
      vscode.window.showInformationMessage(l10n("import.sibling.none"));
      return;
    }

    // Pre-checked multi-select: the user confirms which siblings to pull in.
    type SiblingItem = vscode.QuickPickItem & { sibling: SiblingFavorites };
    const items: SiblingItem[] = found.map((s) => ({
      label: s.siblingName,
      description: s.fileLabel,
      detail: s.fileUri.fsPath,
      picked: true,
      sibling: s,
    }));
    const picks = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: l10n("import.sibling.placeholder"),
    });
    if (!picks || picks.length === 0) {
      return;
    }

    let total = 0;
    for (const pick of picks) {
      total += await importSiblingFavorites(pick.sibling, store);
    }
    vscode.window.showInformationMessage(
      total > 0
        ? l10n("import.sibling.done", { count: total })
        : l10n("import.sibling.nothingNew")
    );
  });
}

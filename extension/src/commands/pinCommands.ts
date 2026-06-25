import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, PinScope, pinKind } from "../model/pin";
import { PinFolderItem, PinGroupItem, PinTreeItem } from "../views/pinTreeItem";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import {
  runPin as execRunPin,
  runAction,
  getOutputChannel,
  isRunnable,
} from "../exec/runner";
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
import { configureRun, parseArgs, formatArgs } from "./configureRun";
import { configureSchedule } from "./configureSchedule";
import { configureAppearance } from "./configureAppearance";
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

// The path-like string to copy for a right-clicked tree node. A file pin yields
// its resolved absolute fsPath (the canonical resolution used elsewhere), with
// the stored path as a fallback when it cannot be resolved (missing folder). A
// non-file recipe pin (url / shell / command / macro) has no file on disk, so
// its action target (`pin.path`) is the meaningful thing to copy. Any other tree
// item that carries a resourceUri (the Project Files rows) yields that path.
// Returns undefined for nodes with nothing to copy (scope roots, group folders).
function pathToCopy(store: PinStore, arg: unknown): string | undefined {
  if (arg instanceof PinTreeItem) {
    const pin = arg.pin;
    if (pinKind(pin) === "file") {
      return store.resolveUri(pin)?.fsPath ?? pin.path;
    }
    return pin.path;
  }
  if (arg instanceof vscode.TreeItem && arg.resourceUri) {
    return arg.resourceUri.fsPath;
  }
  return undefined;
}

async function openPin(store: PinStore, pin: Pin): Promise<void> {
  // A non-file pin has no document to open; "open" performs its action (a URL,
  // command, shell run, or macro), so a single click does the sensible thing.
  if (pinKind(pin) !== "file") {
    await runAction(pin);
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

async function runPinCommand(store: PinStore, pin: Pin): Promise<void> {
  // Non-file pins (recipes: url/shell/command/macro) run through the action
  // dispatcher rather than the file runner.
  if (pinKind(pin) !== "file") {
    await runAction(pin);
    return;
  }
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

// QuickPick over every pin across scopes and groups, recently-run ones first, so
// a pin can be chosen without opening the sidebar (4.1). Shared by "Run Pin..."
// and "Run Pin with Overrides...". Returns undefined on empty set or dismissal.
async function pickPin(
  store: PinStore,
  placeHolder: string
): Promise<Pin | undefined> {
  const all = [...store.getProjectPins(), ...store.getGlobalPins()];
  if (all.length === 0) {
    vscode.window.showInformationMessage(l10n("runAny.empty"));
    return undefined;
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
    placeHolder,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return pick?.pin;
}

// Run a chosen pin directly through the shared runPinCommand path (4.1).
async function runAnyPin(store: PinStore): Promise<void> {
  const pin = await pickPin(store, l10n("runAny.placeholder"));
  if (pin) {
    await runPinCommand(store, pin);
  }
}

// Run a pin with one-off argument / working-directory / environment overrides for
// this invocation only — the stored pin is untouched (7.7). Pre-fills from the
// stored config; canceling any step runs nothing. Runs through runPinCommand on
// an ephemeral clone that shares the pin's id, so uri resolution and recents are
// identical to a normal run.
async function runPinWithOverrides(store: PinStore): Promise<void> {
  const pin = await pickPin(store, l10n("override.pickPlaceholder"));
  if (!pin) {
    return;
  }

  const argsLine = await vscode.window.showInputBox({
    title: l10n("override.title", { name: pin.label ?? pin.path }),
    prompt: l10n("override.argsPrompt"),
    value: pin.exec?.args ? formatArgs(pin.exec.args) : "",
  });
  if (argsLine === undefined) {
    return;
  }

  const cwd = await vscode.window.showInputBox({
    title: l10n("override.title", { name: pin.label ?? pin.path }),
    prompt: l10n("override.cwdPrompt"),
    value: pin.exec?.cwd ?? "",
  });
  if (cwd === undefined) {
    return;
  }

  const envLine = await vscode.window.showInputBox({
    title: l10n("override.title", { name: pin.label ?? pin.path }),
    prompt: l10n("override.envPrompt"),
    placeHolder: l10n("override.envPlaceholder"),
    value: formatEnv(pin.exec?.env),
  });
  if (envLine === undefined) {
    return;
  }

  // Ephemeral clone: overrides apply to this run only; the persisted pin is
  // unchanged. cwd left blank reverts to the default (owning folder).
  const parsedArgs = parseArgs(argsLine);
  const overridden: Pin = {
    ...pin,
    exec: {
      ...pin.exec,
      args: parsedArgs.length > 0 ? parsedArgs : undefined,
      cwd: cwd.trim() === "" ? undefined : cwd.trim(),
      env: parseEnv(envLine),
    },
  };
  await runPinCommand(store, overridden);
}

// Render an env map as "KEY=value KEY2=value2" for the overrides input box.
function formatEnv(env: Record<string, string> | undefined): string {
  if (!env) {
    return "";
  }
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

// Parse a "KEY=value KEY2=value2" line back into an env map; entries without an
// "=" are skipped. Returns undefined when empty so the run inherits the
// environment unchanged.
function parseEnv(line: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const token of parseArgs(line)) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      out[token.slice(0, eq)] = token.slice(eq + 1);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

  reg("saropaWorkspace.runPinWithOverrides", () => runPinWithOverrides(store));

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

  reg("saropaWorkspace.configureAppearance", async (arg: unknown) => {
    const pin = asPin(arg);
    if (pin) {
      await configureAppearance(store, pin);
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

  // Copy a tree node's full path to the clipboard. Available on every file-backed
  // row across both views (file pins, recipes, and the Project Files list); a
  // non-file recipe copies its action target. Nodes with nothing to copy (scope
  // roots, group folders) are no-ops — the menu is gated to file-backed items.
  reg("saropaWorkspace.copyPath", async (arg: unknown) => {
    const value = pathToCopy(store, arg);
    if (!value) {
      return;
    }
    await vscode.env.clipboard.writeText(value);
    vscode.window.showInformationMessage(l10n("path.copied", { path: value }));
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

  // Convert a detected recipe into a stored, fully-editable pin (and suppress the
  // detected one so it does not duplicate).
  reg("saropaWorkspace.promoteRecipe", async (arg: unknown) => {
    const pin = asPin(arg);
    if (!pin) {
      return;
    }
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    const promoted = await store.promoteRecipe(pin);
    if (promoted) {
      vscode.window.showInformationMessage(l10n("recipe.promoted", { name }));
    }
  });

  reg("saropaWorkspace.restoreRecipes", async () => {
    const count = await store.restoreRecipes();
    vscode.window.showInformationMessage(
      count > 0
        ? l10n("recipe.restored", { count })
        : l10n("recipe.noneRemoved")
    );
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

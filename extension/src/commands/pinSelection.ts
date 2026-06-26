import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, PinScope, pinKind, isAnnotationPin } from "../model/pin";
import { PinTreeItem, PinGroupItem } from "../views/pinTreeItem";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { detectRunTargets, RunTarget } from "../exec/runTargets";
import { formatArgs, parseArgs } from "./configureRun";
import { l10n } from "../i18n/l10n";
import { runPinCommand } from "./pinExecution";

// Pin picking, creation, management, and tree-argument resolution. Split out of
// pinCommands.ts so the command-registration file stays a thin dispatcher; these
// are the helpers that turn a menu/keybinding argument into a pin or a file, pick a
// pin from a palette, and add/remove/annotate pins. The run-execution hub lives in
// pinExecution; the open/peek/tail surface in pinInteraction.

// Menu/command invocations hand us either a PinTreeItem (context menus, inline
// buttons) or a raw Pin (the click dispatcher). Normalize to a Pin.
export function asPin(arg: unknown): Pin | undefined {
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
export function pathToCopy(store: PinStore, arg: unknown): string | undefined {
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

// Pin the active editor's file at the current cursor line as a "line pin" (WOW #22):
// opening it later jumps straight to this line and flashes it. Project scope when the
// file is inside a workspace folder, else global (a project pin must be folder-
// relative). The label carries the line so several line pins to one file are
// distinguishable in the tree.
export async function pinToLine(store: PinStore): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(l10n("pin.noActiveFile"));
    return;
  }
  const uri = editor.document.uri;
  const line = editor.selection.active.line + 1; // store 1-based
  const base = uri.path.split("/").pop() ?? uri.fsPath;
  const label = l10n("linePin.label", { name: base, line });
  // Project scope only when the file lives in a workspace folder (its path must be
  // folder-relative); otherwise global, so an external file still gets a line pin.
  const scope: PinScope = vscode.workspace.getWorkspaceFolder(uri)
    ? "project"
    : "global";
  await store.addLinePin(uri, scope, line, label);
  vscode.window.showInformationMessage(l10n("linePin.added", { name: base, line }));
}

export async function pinUri(store: PinStore, uri: vscode.Uri, scope: PinScope): Promise<void> {
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

// The file an editor-title / editor-tab "Pin Active File" invocation targets. The
// editor/title (and /context) menu passes the URI of the tab the user acted on as
// the first argument; honoring it is what makes right-clicking a specific tab pin
// THAT tab rather than whichever editor happens to be active (the bug where the
// active config tab was re-pinned no matter which tab was clicked). Falls back to
// the active editor for the keyboard / command-palette path, which passes no arg.
export function editorTargetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  return activeFileUri();
}

// The file an add/remove-pin command should act on, resolved from whatever the
// invoking surface hands over: a raw Uri (the Explorer "Workspace Pin" submenu),
// a pin row (the Pins view — resolve its pin back to a file), or any other tree
// row carrying a resourceUri (the Project Files rows). One resolver lets the four
// add/remove commands serve all three surfaces, so the gesture never depends on
// which editor is focused.
export function targetUri(store: PinStore, arg: unknown): vscode.Uri | undefined {
  // The editor-title (tab) and Explorer menus pass the acted-on file as a Uri —
  // honor it, so right-clicking a specific tab targets THAT tab, not the active
  // one.
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  // A Pins-view row: resolve the pin back to its file (undefined for a non-file
  // recipe, which the submenu is gated against).
  if (arg instanceof PinTreeItem) {
    return store.resolveUri(arg.pin);
  }
  // A Project Files row (or any other file-backed tree row).
  if (arg instanceof vscode.TreeItem) {
    return arg.resourceUri;
  }
  // The editor-body context menu, command palette, and keybindings pass no tree
  // context: act on the file in the active editor.
  return activeFileUri();
}

// Remove the pin in a given scope that resolves to a file, naming it in the
// toast. A no-op-with-feedback when the file is not actually pinned in that scope
// (the "Remove from ... Pins" submenu item is static, so it can be invoked on a
// file that is not pinned there).
export async function removePinForUri(
  store: PinStore,
  uri: vscode.Uri,
  scope: PinScope
): Promise<void> {
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  const pin = store.findPinByUri(uri, scope);
  if (!pin) {
    const where =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    vscode.window.showInformationMessage(
      l10n("pin.notPinned", { name: fileName, scope: where })
    );
    return;
  }
  const name = pin.label ?? fileName;
  await store.removePin(pin);
  // Drop any last-run badge so it does not outlive the pin.
  runStatusRegistry.clear(pin.id);
  vscode.window.showInformationMessage(l10n("pin.removed", { name }));
}

// Number of generic "run top pin N" keybinding slots exposed (4.2).
export const TOP_PIN_SLOTS = 5;

// The pins in tree order (project first, then global) — the order the "top pin N"
// keybindings and reorder-by-drag designate. Comment / separator annotations are
// excluded: they are not runnable, so they must not consume a "top pin N" slot or
// resolve as a run-by-reference target.
export function orderedPins(store: PinStore): Pin[] {
  return [...store.getProjectPins(), ...store.getGlobalPins()].filter(
    (p) => !isAnnotationPin(p)
  );
}

// Run the Nth pin (1-based) for the runTopPinN keybindings.
export function runTopPin(store: PinStore, slot: number): void {
  const pin = orderedPins(store)[slot - 1];
  if (pin) {
    void runPinCommand(store, pin);
  } else {
    vscode.window.showInformationMessage(l10n("runTop.noPin", { slot }));
  }
}

// Resolve a keybinding `args` reference to a pin: by id, then label, then full
// path, then basename. First match across project + global wins.
export function resolvePinRef(store: PinStore, ref: unknown): Pin | undefined {
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
  // Comment / separator annotations are not runnable, so they never appear in the
  // "Run Pin..." list (picking one would do nothing).
  const all = [...store.getProjectPins(), ...store.getGlobalPins()].filter(
    (p) => !isAnnotationPin(p)
  );
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
  const recentPins = telemetry
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
export async function runAnyPin(store: PinStore): Promise<void> {
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
export async function runPinWithOverrides(store: PinStore): Promise<void> {
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
export function scopeFromAddGroupArg(arg: unknown): PinScope {
  return arg instanceof PinGroupItem ? arg.group : "project";
}

// Add a comment or separator annotation that labels / divides the pin list. When
// invoked from a pin's context menu the annotation is inserted right after that
// pin (same scope + group), so it lands where the user clicked; from the view
// title it appends to the project scope's top level. A comment prompts for its
// text; a separator carries none. Reports the added entry, naming its text.
export async function addAnnotation(
  store: PinStore,
  kind: "comment" | "separator",
  arg: unknown
): Promise<void> {
  const after = asPin(arg);
  let label: string | undefined;
  if (kind === "comment") {
    label = await vscode.window.showInputBox({
      prompt: l10n("annotation.commentPrompt"),
      placeHolder: l10n("annotation.commentPlaceholder"),
      validateInput: (value) =>
        value.trim().length === 0 ? l10n("annotation.commentEmptyError") : undefined,
    });
    // Esc / empty cancels — nothing is added.
    if (label === undefined) {
      return;
    }
  }
  const scope: PinScope = after?.scope ?? "project";
  const added = await store.addAnnotationPin(kind, scope, label, after);
  if (!added) {
    // The only failure path is a project annotation with no workspace folder open.
    vscode.window.showWarningMessage(l10n("annotation.noWorkspace"));
    return;
  }
  vscode.window.showInformationMessage(
    kind === "comment"
      ? l10n("annotation.commentAdded", { text: label?.trim() ?? "" })
      : l10n("annotation.separatorAdded")
  );
}

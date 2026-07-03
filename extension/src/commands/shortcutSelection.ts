import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, ShortcutScope, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { defaultGroupLabel } from "../model/shortcutStoreShared";
import { ShortcutTreeItem, ShortcutGroupItem } from "../views/shortcutTreeItem";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { detectRunTargets, RunTarget } from "../exec/runTargets";
import { formatArgs, parseArgs } from "./configureRun";
import { l10n } from "../i18n/l10n";
import { runShortcutCommand } from "./shortcutExecution";

// Shortcut picking, creation, management, and tree-argument resolution. Split out of
// pinCommands.ts so the command-registration file stays a thin dispatcher; these
// are the helpers that turn a menu/keybinding argument into a shortcut or a file, pick a
// shortcut from a palette, and add/remove/annotate shortcuts. The run-execution hub lives
// in pinExecution; the open/peek surface in pinInteraction.

// Menu/command invocations hand us either a ShortcutTreeItem (context menus, inline
// buttons) or a raw Shortcut (the click dispatcher). Normalize to a Shortcut.
export function asShortcut(arg: unknown): Shortcut | undefined {
  if (arg instanceof ShortcutTreeItem) {
    return arg.shortcut;
  }
  if (arg && typeof arg === "object" && "id" in arg && "scope" in arg) {
    return arg as Shortcut;
  }
  return undefined;
}

// The path-like string to copy for a right-clicked tree node. A file shortcut yields
// its resolved absolute fsPath (the canonical resolution used elsewhere), with
// the stored path as a fallback when it cannot be resolved (missing folder). A
// non-file recipe shortcut (url / shell / command / macro) has no file on disk, so
// its action target (`shortcut.path`) is the meaningful thing to copy. Any other tree
// item that carries a resourceUri (the Project Files rows) yields that path.
// Returns undefined for nodes with nothing to copy (scope roots, group folders).
export function pathToCopy(store: ShortcutStore, arg: unknown): string | undefined {
  if (arg instanceof ShortcutTreeItem) {
    const shortcut = arg.shortcut;
    if (shortcutKind(shortcut) === "file") {
      return store.resolveUri(shortcut)?.fsPath ?? shortcut.path;
    }
    return shortcut.path;
  }
  if (arg instanceof vscode.TreeItem && arg.resourceUri) {
    return arg.resourceUri.fsPath;
  }
  return undefined;
}

// Add the active editor's file at the current cursor line as a "line shortcut" (WOW #22):
// opening it later jumps straight to this line and flashes it. Project scope when the
// file is inside a workspace folder, else global (a project shortcut must be folder-
// relative). The label carries the line so several line shortcuts to one file are
// distinguishable in the tree.
export async function shortcutToLine(store: ShortcutStore): Promise<void> {
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
  // folder-relative); otherwise global, so an external file still gets a line shortcut.
  const scope: ShortcutScope = vscode.workspace.getWorkspaceFolder(uri)
    ? "project"
    : "global";
  await store.addLineShortcut(uri, scope, line, label);
  vscode.window.showInformationMessage(l10n("linePin.added", { name: base, line }));
}

export async function shortcutUri(store: ShortcutStore, uri: vscode.Uri, scope: ShortcutScope): Promise<void> {
  const name = uri.path.split("/").pop() ?? uri.fsPath;
  const added = await store.addShortcut(uri, scope);
  if (added) {
    // Name the default group the file was auto-sorted into (e.g. "Added publish.sh to
    // Deploy"), so the user sees where it landed rather than guessing. The shortcut is
    // in the store cache after addShortcut's refresh; a file that matched no rule (or a
    // global add, where default groups do not apply) has no default group and shows the
    // plain confirmation.
    const group = defaultGroupLabel(store.findShortcutByUri(uri, scope)?.groupId);
    vscode.window.showInformationMessage(
      group ? l10n("pin.addedToGroup", { name, group }) : l10n("pin.added", { name })
    );
    // Offer inferred run targets (npm scripts, Make targets, a shebang) so the
    // shortcut runs the right thing without the user typing a command (7.5).
    await offerRunTarget(store, uri, scope, name);
  } else {
    vscode.window.showInformationMessage(l10n("pin.alreadyPinned", { name }));
  }
}

// After a file is added, detect run targets within it and, if any exist, let the
// user pick one to write as the shortcut's run config. Esc/dismiss leaves the shortcut
// with no run config (today's interpreter-default behavior) — the offer never blocks.
async function offerRunTarget(
  store: ShortcutStore,
  uri: vscode.Uri,
  scope: ShortcutScope,
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
  const shortcut = store.findShortcutByUri(uri, scope);
  if (!shortcut) {
    return;
  }
  await store.updateShortcutExec(shortcut, pick.target.exec);
  vscode.window.showInformationMessage(
    l10n("runTarget.applied", { name, target: pick.label.replace(/^\$\([^)]*\)\s*/, "") })
  );
}

function activeFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

// The file an editor-title / editor-tab "Pin Active File" invocation targets. The
// editor/title (and /context) menu passes the URI of the tab the user acted on as
// the first argument; honoring it is what makes right-clicking a specific tab add
// THAT tab rather than whichever editor happens to be active (the bug where the
// active config tab was re-added no matter which tab was clicked). Falls back to
// the active editor for the keyboard / command-palette path, which passes no arg.
export function editorTargetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  return activeFileUri();
}

// The file an add/remove-shortcut command should act on, resolved from whatever the
// invoking surface hands over: a raw Uri (the Explorer "Workspace Pin" submenu),
// a shortcut row (the Shortcuts view — resolve its shortcut back to a file), or any other
// tree row carrying a resourceUri (the Project Files rows). One resolver lets the four
// add/remove commands serve all three surfaces, so the gesture never depends on
// which editor is focused.
export function targetUri(store: ShortcutStore, arg: unknown): vscode.Uri | undefined {
  // The editor-title (tab) and Explorer menus pass the acted-on file as a Uri —
  // honor it, so right-clicking a specific tab targets THAT tab, not the active
  // one.
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  // A Shortcuts-view row: resolve the shortcut back to its file (undefined for a non-file
  // recipe, which the submenu is gated against).
  if (arg instanceof ShortcutTreeItem) {
    return store.resolveUri(arg.shortcut);
  }
  // A Project Files row (or any other file-backed tree row).
  if (arg instanceof vscode.TreeItem) {
    return arg.resourceUri;
  }
  // The editor-body context menu, command palette, and keybindings pass no tree
  // context: act on the file in the active editor.
  return activeFileUri();
}

// Remove the shortcut in a given scope that resolves to a file, naming it in the
// toast. A no-op-with-feedback when the file is not actually a shortcut in that scope
// (the "Remove from ... Shortcuts" submenu item is static, so it can be invoked on a
// file that is not a shortcut there).
export async function removeShortcutForUri(
  store: ShortcutStore,
  uri: vscode.Uri,
  scope: ShortcutScope
): Promise<void> {
  const fileName = uri.path.split("/").pop() ?? uri.fsPath;
  const shortcut = store.findShortcutByUri(uri, scope);
  if (!shortcut) {
    const where =
      scope === "global"
        ? l10n("pin.group.global")
        : l10n("pin.group.project");
    vscode.window.showInformationMessage(
      l10n("pin.notPinned", { name: fileName, scope: where })
    );
    return;
  }
  const name = shortcut.label ?? fileName;
  await store.removeShortcut(shortcut);
  // Drop any last-run badge so it does not outlive the shortcut.
  runStatusRegistry.clear(shortcut.id);
  vscode.window.showInformationMessage(l10n("pin.removed", { name }));
}

// Number of generic "run top shortcut N" keybinding slots exposed (4.2).
export const TOP_SHORTCUT_SLOTS = 5;

// The shortcuts in tree order (project first, then global) — the order the "top shortcut N"
// keybindings and reorder-by-drag designate. Comment / separator annotations are
// excluded: they are not runnable, so they must not consume a "top shortcut N" slot or
// resolve as a run-by-reference target.
export function orderedShortcuts(store: ShortcutStore): Shortcut[] {
  return [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()].filter(
    (p) => !isAnnotationShortcut(p)
  );
}

// Run the Nth shortcut (1-based) for the runTopPinN keybindings.
export function runTopShortcut(store: ShortcutStore, slot: number): void {
  const shortcut = orderedShortcuts(store)[slot - 1];
  if (shortcut) {
    void runShortcutCommand(store, shortcut);
  } else {
    vscode.window.showInformationMessage(l10n("runTop.noPin", { slot }));
  }
}

// Resolve a keybinding `args` reference to a shortcut: by id, then label, then full
// path, then basename. First match across project + global wins.
export function resolveShortcutRef(store: ShortcutStore, ref: unknown): Shortcut | undefined {
  if (typeof ref !== "string" || ref.trim() === "") {
    return undefined;
  }
  const needle = ref.trim();
  const shortcuts = orderedShortcuts(store);
  return (
    shortcuts.find((p) => p.id === needle) ??
    shortcuts.find((p) => p.label === needle) ??
    shortcuts.find((p) => p.path === needle) ??
    shortcuts.find((p) => (p.path.split("/").pop() ?? p.path) === needle)
  );
}

// Build the scope + group descriptor shown beside a shortcut in the Run Shortcut palette,
// so the same filename in two scopes/groups is distinguishable at a glance.
function shortcutLocation(store: ShortcutStore, shortcut: Shortcut): string {
  const scope =
    shortcut.scope === "global"
      ? l10n("pin.group.global")
      : l10n("pin.group.project");
  if (!shortcut.groupId) {
    return scope;
  }
  const group = store.getGroups(shortcut.scope).find((g) => g.id === shortcut.groupId);
  return group ? `${scope} / ${group.label}` : scope;
}

// QuickPick over every shortcut across scopes and groups, recently-run ones first, so
// a shortcut can be chosen without opening the sidebar (4.1). Shared by "Run Shortcut..."
// and "Run Shortcut with Overrides...". Returns undefined on empty set or dismissal.
async function pickShortcut(
  store: ShortcutStore,
  placeHolder: string
): Promise<Shortcut | undefined> {
  // Comment / separator annotations are not runnable, so they never appear in the
  // "Run Shortcut..." list (picking one would do nothing).
  const all = [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()].filter(
    (p) => !isAnnotationShortcut(p)
  );
  if (all.length === 0) {
    vscode.window.showInformationMessage(l10n("runAny.empty"));
    return undefined;
  }

  type ShortcutItem = vscode.QuickPickItem & { shortcut?: Shortcut };
  const toItem = (shortcut: Shortcut): ShortcutItem => ({
    label: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
    description: shortcutLocation(store, shortcut),
    detail: shortcut.path,
    shortcut,
  });

  // Recents first (only ids that still resolve to a live shortcut), then a separator
  // and the full set ordered as the tree shows it.
  const recentShortcuts = telemetry
    .list()
    .map((id) => store.findShortcut(id))
    .filter((p): p is Shortcut => p !== undefined);

  const items: ShortcutItem[] = [];
  if (recentShortcuts.length > 0) {
    items.push({
      label: l10n("runAny.recent"),
      kind: vscode.QuickPickItemKind.Separator,
    });
    items.push(...recentShortcuts.map(toItem));
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
  return pick?.shortcut;
}

// Run a chosen shortcut directly through the shared runShortcutCommand path (4.1).
export async function runAnyShortcut(store: ShortcutStore): Promise<void> {
  const shortcut = await pickShortcut(store, l10n("runAny.placeholder"));
  if (shortcut) {
    await runShortcutCommand(store, shortcut);
  }
}

// Run a shortcut with one-off argument / working-directory / environment overrides for
// this invocation only — the stored shortcut is untouched (7.7). Pre-fills from the
// stored config; canceling any step runs nothing. Runs through runShortcutCommand on
// an ephemeral clone that shares the shortcut's id, so uri resolution and recents are
// identical to a normal run.
export async function runShortcutWithOverrides(store: ShortcutStore): Promise<void> {
  const shortcut = await pickShortcut(store, l10n("override.pickPlaceholder"));
  if (!shortcut) {
    return;
  }

  const argsLine = await vscode.window.showInputBox({
    title: l10n("override.title", { name: shortcut.label ?? shortcut.path }),
    prompt: l10n("override.argsPrompt"),
    value: shortcut.exec?.args ? formatArgs(shortcut.exec.args) : "",
  });
  if (argsLine === undefined) {
    return;
  }

  const cwd = await vscode.window.showInputBox({
    title: l10n("override.title", { name: shortcut.label ?? shortcut.path }),
    prompt: l10n("override.cwdPrompt"),
    value: shortcut.exec?.cwd ?? "",
  });
  if (cwd === undefined) {
    return;
  }

  const envLine = await vscode.window.showInputBox({
    title: l10n("override.title", { name: shortcut.label ?? shortcut.path }),
    prompt: l10n("override.envPrompt"),
    placeHolder: l10n("override.envPlaceholder"),
    value: formatEnv(shortcut.exec?.env),
  });
  if (envLine === undefined) {
    return;
  }

  // Ephemeral clone: overrides apply to this run only; the persisted shortcut is
  // unchanged. cwd left blank reverts to the default (owning folder).
  const parsedArgs = parseArgs(argsLine);
  const overridden: Shortcut = {
    ...shortcut,
    exec: {
      ...shortcut.exec,
      args: parsedArgs.length > 0 ? parsedArgs : undefined,
      cwd: cwd.trim() === "" ? undefined : cwd.trim(),
      env: parseEnv(envLine),
    },
  };
  await runShortcutCommand(store, overridden);
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
// repo-shared scope) or a scope root's context menu (a ShortcutGroupItem carrying its
// scope). Default to project so a title-bar click has a defined home.
export function scopeFromAddGroupArg(arg: unknown): ShortcutScope {
  return arg instanceof ShortcutGroupItem ? arg.group : "project";
}

// Add a comment or separator annotation that labels / divides the shortcut list. When
// invoked from a shortcut's context menu the annotation is inserted right after that
// shortcut (same scope + group), so it lands where the user clicked; from the view
// title it appends to the project scope's top level. A comment prompts for its
// text; a separator carries none. Reports the added entry, naming its text.
export async function addAnnotation(
  store: ShortcutStore,
  kind: "comment" | "separator",
  arg: unknown
): Promise<void> {
  const after = asShortcut(arg);
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
  const scope: ShortcutScope = after?.scope ?? "project";
  const added = await store.addAnnotationShortcut(kind, scope, label, after);
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

// A bare host/path with no scheme (e.g. "github.com/saropa") is treated as https so it
// just works; an explicit scheme (http/https/mailto/vscode/file/...) is preserved. The
// runner opens the stored value verbatim via Uri.parse, so normalizing here is what
// makes a scheme-less entry openable rather than parsed as a relative reference.
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Add a website/URL shortcut the user authored by hand. Prompts for the URL (required)
// then an optional display label; a single click opens the site directly. When invoked
// from a shortcut's context menu the shortcut is inserted right after that shortcut
// (same scope + group), so it lands where the user clicked; from a view-title entry it
// appends to the given scope's top level. Reports the added shortcut, naming it.
export async function addUrl(
  store: ShortcutStore,
  scope: ShortcutScope,
  arg: unknown
): Promise<void> {
  const after = asShortcut(arg);
  const url = await vscode.window.showInputBox({
    prompt: l10n("url.addPrompt"),
    placeHolder: l10n("url.addPlaceholder"),
    validateInput: (value) =>
      value.trim().length === 0 ? l10n("url.emptyError") : undefined,
  });
  // Esc / empty cancels — nothing is added.
  if (url === undefined) {
    return;
  }
  // The label is optional: submitting empty ("") keeps the URL as the display name;
  // Esc (undefined) backs out of the whole gesture, matching a multi-step input flow.
  const label = await vscode.window.showInputBox({
    prompt: l10n("url.labelPrompt"),
    placeHolder: l10n("url.labelPlaceholder"),
  });
  if (label === undefined) {
    return;
  }
  const normalized = normalizeUrl(url);
  const targetScope: ShortcutScope = after?.scope ?? scope;
  const added = await store.addUrlShortcut(normalized, targetScope, label, after);
  if (!added) {
    // The only failure path is a project entry with no workspace folder open.
    vscode.window.showWarningMessage(l10n("url.noWorkspace"));
    return;
  }
  vscode.window.showInformationMessage(
    l10n("url.added", { name: label.trim() || normalized, url: normalized })
  );
}

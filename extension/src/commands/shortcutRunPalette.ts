import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, isAnnotationShortcut } from "../model/shortcut";
import { telemetry } from "../exec/telemetry";
import { l10n } from "../i18n/l10n";
import { runShortcutCommand } from "./shortcutExecution";
import { formatArgs, parseArgs } from "./configureRun";

// The "run a shortcut without opening the tree" surfaces: the numbered top-shortcut
// keybindings, the run-by-reference command, and the Run Shortcut / Run with Overrides
// QuickPick palettes. Split out of shortcutSelection.ts.

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

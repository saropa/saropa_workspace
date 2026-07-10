import * as vscode from "vscode";
import * as path from "path";
import { Shortcut, ShortcutExecConfig } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

// The path / environment / dependency field editors for the run-parameters hub:
// working directory (with presets + inline existence validation), environment
// variables (an add/edit/delete sub-hub), and the prerequisite-shortcut dependency.
// Split out of configureRun.ts so the hub file holds the flow.

export async function editCwd(
  work: ShortcutExecConfig,
  title: string,
  store: ShortcutStore,
  shortcut: Shortcut
): Promise<void> {
  const uri = store.resolveUri(shortcut);
  const owningFolder = uri
    ? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
    : undefined;
  const fileDir = uri ? path.dirname(uri.fsPath) : undefined;

  interface CwdItem extends vscode.QuickPickItem {
    id: "default" | "workspace" | "fileDir" | "custom";
    value?: string;
  }
  const items: CwdItem[] = [
    {
      id: "default",
      label: l10n("configure.cwd.default"),
      description: owningFolder ?? l10n("configure.value.cwdDefault"),
    },
  ];
  if (owningFolder) {
    items.push({
      id: "workspace",
      label: l10n("configure.cwd.workspace"),
      description: owningFolder,
      value: owningFolder,
    });
  }
  if (fileDir && fileDir !== owningFolder) {
    items.push({
      id: "fileDir",
      label: l10n("configure.cwd.fileDir"),
      description: fileDir,
      value: fileDir,
    });
  }
  items.push({ id: "custom", label: l10n("configure.cwd.custom") });

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.cwd.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  if (pick.id === "default") {
    work.cwd = undefined;
    return;
  }
  if (pick.id === "custom") {
    const entered = await vscode.window.showInputBox({
      title,
      prompt: l10n("configure.cwd.customPrompt"),
      value: work.cwd ?? "",
      ignoreFocusOut: true,
      // Validate existence inline so an invalid path never persists.
      validateInput: async (input) => {
        if (input.trim() === "") {
          return l10n("configure.cwd.empty");
        }
        return (await directoryExists(input.trim()))
          ? undefined
          : l10n("configure.cwd.notFound");
      },
    });
    if (entered === undefined) {
      return;
    }
    work.cwd = entered.trim();
    return;
  }
  work.cwd = pick.value;
}

async function directoryExists(fsPath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

interface EnvItem extends vscode.QuickPickItem {
  id: string; // "add" or "var:<key>"
}

// Sub-hub list: an "Add" action plus one row per existing KEY = value pair.
function buildEnvItems(env: Record<string, string>): EnvItem[] {
  const items: EnvItem[] = [{ id: "add", label: l10n("configure.env.add") }];
  for (const key of Object.keys(env)) {
    items.push({
      id: `var:${key}`,
      label: `$(symbol-variable) ${key}`,
      description: env[key],
    });
  }
  return items;
}

// Environment-variable sub-hub: loops a QuickPick of an "Add" row plus one row per
// existing KEY = value pair so the user can manage several variables before returning
// to the run-parameters hub. Esc returns with whatever edits were already made intact.
export async function editEnv(work: ShortcutExecConfig, title: string): Promise<void> {
  // Sub-hub: list each KEY = value, an Add action, and per-entry edit/remove.
  // Looping here lets the user manage several variables before returning.
  for (;;) {
    const env = work.env ?? {};
    const keys = Object.keys(env);
    const items = buildEnvItems(env);

    const pick = await vscode.window.showQuickPick(items, {
      title,
      placeHolder: l10n("configure.env.placeholder"),
      ignoreFocusOut: true,
    });
    if (!pick) {
      // Esc returns to the hub with the env edits made so far retained in `work`.
      return;
    }

    if (pick.id === "add") {
      await handleAddEnvVar(work, title, keys);
      continue;
    }

    // Existing entry: edit its value or remove it.
    const key = pick.id.slice("var:".length);
    await handleEditExistingEnvVar(work, title, key);
  }
}

// "Add" branch: prompt for a new key (validated for empty / "=" / duplicate),
// then its value. Leaves `work` untouched if either prompt is dismissed.
async function handleAddEnvVar(
  work: ShortcutExecConfig,
  title: string,
  keys: string[]
): Promise<void> {
  const env = work.env ?? {};
  const key = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.env.keyPrompt"),
    ignoreFocusOut: true,
    validateInput: (input) => validateEnvKey(input, keys),
  });
  if (key === undefined) {
    return;
  }
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.env.valuePrompt", { key: key.trim() }),
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  work.env = { ...env, [key.trim()]: value };
}

// Existing-entry branch: a nested edit/delete pick, then that action's prompt.
async function handleEditExistingEnvVar(
  work: ShortcutExecConfig,
  title: string,
  key: string
): Promise<void> {
  const env = work.env ?? {};
  interface EnvActionItem extends vscode.QuickPickItem {
    id: "edit" | "delete";
  }
  const action = await vscode.window.showQuickPick<EnvActionItem>(
    [
      { id: "edit", label: l10n("configure.env.edit") },
      { id: "delete", label: l10n("configure.env.delete") },
    ],
    {
      title,
      placeHolder: l10n("configure.env.actionPlaceholder", { key }),
      ignoreFocusOut: true,
    }
  );
  if (!action) {
    return;
  }
  if (action.id === "edit") {
    const value = await vscode.window.showInputBox({
      title,
      prompt: l10n("configure.env.valuePrompt", { key }),
      value: env[key],
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return;
    }
    work.env = { ...env, [key]: value };
  } else {
    const { [key]: _removed, ...rest } = env;
    work.env = rest;
  }
}

function validateEnvKey(input: string, existing: string[]): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return l10n("configure.env.keyEmpty");
  }
  if (trimmed.includes("=")) {
    return l10n("configure.env.keyEquals");
  }
  if (existing.includes(trimmed)) {
    return l10n("configure.env.keyDuplicate", { key: trimmed });
  }
  return undefined;
}

// Display name for a dependency shortcut id (the hub shows the prerequisite's name, not
// its opaque id). Falls back to a placeholder when the id no longer resolves.
export function resolveDepName(store: ShortcutStore, id: string): string {
  const dep = store.findShortcut(id);
  return dep
    ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
    : l10n("configure.dependsOn.unknown");
}

// Pick the shortcut that must succeed before this one runs (WOW #13), or clear the
// dependency. Lists the other shortcuts across both scopes; recipe shortcuts are excluded
// (they are detected shortcuts, not the user's own build steps), and the shortcut itself
// cannot depend on itself.
export async function editDependsOn(
  work: ShortcutExecConfig,
  title: string,
  store: ShortcutStore,
  shortcut: Shortcut
): Promise<void> {
  interface DepItem extends vscode.QuickPickItem {
    id?: string;
  }
  const items: DepItem[] = [
    { id: undefined, label: l10n("configure.dependsOn.none") },
  ];
  for (const candidate of [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()]) {
    if (candidate.id === shortcut.id || candidate.isRecipe) {
      continue;
    }
    items.push({
      id: candidate.id,
      label: candidate.label ?? (candidate.path.split("/").pop() ?? candidate.path),
      description:
        candidate.scope === "global"
          ? l10n("pin.group.global")
          : l10n("pin.group.project"),
    });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n("configure.dependsOn.placeholder"),
    ignoreFocusOut: true,
  });
  if (!pick) {
    return;
  }
  work.dependsOn = pick.id;
}

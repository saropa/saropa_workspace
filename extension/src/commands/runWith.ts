import * as vscode from "vscode";
import * as path from "path";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { detectInterpreters } from "../exec/interpreterDetect";
import { runShortcutCommand } from "./shortcutExecution";
import { l10n } from "../i18n/l10n";

// "Run with…" — the fast path to choose how a pinned script runs. Detects the
// interpreters actually installed for the file's type (the py launcher, versioned
// Python installs found off PATH, node, pwsh, …), lets the user pick one (or "Run
// directly" / browse for an executable), PERSISTS the choice as the shortcut's
// interpreter, and runs it. Persisting is the point: the next single/double-click then
// uses the same interpreter, so this doubles as the no-JSON way to set a pin's runtime.
// The full Configure Run panel offers the same choices as chips; this is the keyboard /
// right-click shortcut for the common case.

// What a picked row does: set the interpreter prefix to a concrete value (a detected
// command, the file-type default via undefined, or "run directly" via ""), or open a
// file dialog to choose an executable.
type RunWithChoice =
  | { readonly kind: "set"; readonly command: string | undefined; readonly display: string }
  | { readonly kind: "browse" };

type RunWithItem = vscode.QuickPickItem & { readonly choice: RunWithChoice };

// Drive the "Run with…" flow end to end: guard non-file/annotation shortcuts and a
// missing target, detect interpreters, show the QuickPick (or the browse dialog),
// persist the chosen interpreter to the shortcut, and run it via the canonical path.
export async function runWith(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // Only a plain file shortcut runs through an interpreter; a recipe action names its
  // own command and an annotation has nothing to run.
  if (shortcutKind(shortcut) !== "file" || isAnnotationShortcut(shortcut)) {
    vscode.window.showInformationMessage(l10n("runWith.notFile"));
    return;
  }
  const uri = store.resolveUri(shortcut);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }

  const name = shortcut.label ?? path.basename(uri.fsPath);
  const ext = path.extname(uri.fsPath).toLowerCase();
  const detected = await detectInterpreters(ext);

  const items = buildItems(detected, shortcut.exec?.command);
  const pick = await vscode.window.showQuickPick(items, {
    title: l10n("runWith.title", { name }),
    placeHolder: l10n("runWith.placeholder"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) {
    return;
  }

  const resolved = pick.choice.kind === "browse" ? await browseForInterpreter() : pick.choice;
  if (!resolved) {
    return;
  }

  // Merge over the existing exec so args / cwd / env / location are preserved — only the
  // interpreter prefix changes.
  await store.updateShortcutExec(shortcut, { ...shortcut.exec, command: resolved.command });
  vscode.window.showInformationMessage(
    l10n("runWith.set", { name, interpreter: resolved.display })
  );

  // Run with the freshly-saved interpreter via the canonical run path (single-instance
  // guard, dependency gate, missing-file handling). Re-read so the run sees the update.
  const updated = store.findShortcut(shortcut.id) ?? shortcut;
  await runShortcutCommand(store, updated);
}

// Assemble the QuickPick rows: detected interpreters first (the current one checked),
// then a separator, then the always-available choices (file-type default, run directly,
// browse). The detected rows carry their resolved path as the detail so the user sees
// exactly which binary they are choosing.
function buildItems(
  detected: Awaited<ReturnType<typeof detectInterpreters>>,
  currentCommand: string | undefined
): RunWithItem[] {
  const items: RunWithItem[] = detected.map((d) => ({
    label: d.command === currentCommand ? `$(check) ${d.label}` : d.label,
    description: d.command,
    detail: d.path,
    choice: { kind: "set", command: d.command, display: d.label },
  }));

  items.push({
    label: "",
    kind: vscode.QuickPickItemKind.Separator,
    choice: { kind: "set", command: undefined, display: "" },
  });

  // The file-type default (clears the per-pin prefix so the interpreterDefaults map /
  // shebang resolution applies). The short "Default" reads cleanly in the result toast.
  items.push({
    label: `$(settings-gear) ${l10n("runWith.useDefault")}`,
    detail: l10n("runWith.useDefault.detail"),
    choice: { kind: "set", command: undefined, display: l10n("configureRun.interp.useDefault") },
  });
  // Run directly — honored on Unix via the shebang; on Windows the runner still resolves
  // a real interpreter (a bare script path would otherwise open in the editor).
  items.push({
    label: `$(run) ${l10n("runWith.runDirectly")}`,
    detail: l10n("runWith.runDirectly.detail"),
    choice: { kind: "set", command: "", display: l10n("runWith.runDirectly") },
  });
  items.push({
    label: `$(folder-opened) ${l10n("runWith.browse")}`,
    detail: l10n("runWith.browse.detail"),
    choice: { kind: "browse" },
  });
  return items;
}

// Open a file dialog to pick an interpreter executable. The chosen absolute path becomes
// the stored prefix (quoted when it contains spaces so it stays one token).
async function browseForInterpreter(): Promise<{ kind: "set"; command: string; display: string } | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: l10n("runWith.browse.openLabel"),
    title: l10n("runWith.browse.title"),
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }
  const exe = picked[0].fsPath;
  const command = /\s/.test(exe) ? `"${exe}"` : exe;
  return { kind: "set", command, display: path.basename(exe) };
}

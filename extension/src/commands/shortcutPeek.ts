import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut, shortcutKind, isAnnotationShortcut } from "../model/shortcut";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { l10n } from "../i18n/l10n";
import { runShortcutCommand } from "./shortcutExecution";
import { fileExists, handleMissingFile } from "./shortcutOpen";

// The peek-without-leaving-the-editor surface, and the modal that describes a non-file
// shortcut's action before running it. Split out of shortcutInteraction.ts.

// Show a file shortcut inside VS Code's native Peek overlay, floating over the active
// editor at the cursor, instead of opening a new tab (roadmap WOW #14). This lets
// the user glance at a shortcut's file without leaving the editor they are in — focus
// and the active tab are untouched; pressing Escape dismisses the overlay. Falls
// back gracefully: a non-file shortcut has no file to peek (its single-click info shows
// instead), and with no active editor there is nothing to overlay, so the file is
// opened normally.
export async function peekShortcut(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  // A comment / separator annotation has no file to peek — inert by design.
  if (isAnnotationShortcut(shortcut)) {
    return;
  }
  // Peeking is a use of the shortcut, like opening: clear its untapped dot.
  void tappedShortcuts.mark(shortcut.id);
  if (shortcutKind(shortcut) !== "file") {
    await showActionInfo(store, shortcut);
    return;
  }
  const uri = store.resolveUri(shortcut);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: shortcut.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, shortcut, uri);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    // No editor to anchor the peek widget on; opening the file is the closest
    // behavior to "show me this file" when there is nothing to overlay.
    await vscode.window.showTextDocument(uri, { preview: false });
    return;
  }
  // editor.action.peekLocations(resource, position, locations, mode): render the
  // shortcut's file in an inline peek widget anchored at the current cursor. "peek"
  // keeps it a non-navigating overlay (focus stays in the active editor, no tab is
  // opened). The target position is the file's top (line 0), since the whole file
  // is the thing being glanced at, not a specific symbol.
  const target = new vscode.Location(uri, new vscode.Position(0, 0));
  await vscode.commands.executeCommand(
    "editor.action.peekLocations",
    editor.document.uri,
    editor.selection.active,
    [target],
    "peek"
  );
}

// Describe a non-file shortcut's action in one plain line — what running it would do.
function describeAction(shortcut: Shortcut): string {
  const action = shortcut.action;
  if (!action) {
    return shortcut.path;
  }
  switch (action.kind) {
    case "url":
      return l10n("recipe.desc.url", { url: action.url ?? "" });
    case "shell":
      return l10n("recipe.desc.shell", { command: action.shellCommand ?? "" });
    case "command":
      return l10n("recipe.desc.command", { id: action.commandId ?? "" });
    case "macro":
      return l10n("recipe.desc.macro", {
        steps: (action.steps ?? []).map((s) => s.label ?? s.kind).join(" -> "),
      });
    default:
      return shortcut.path;
  }
}

// Single-click surface for a non-file shortcut: a modal describing what it does, with
// Run / Promote actions. Nothing runs unless the user explicitly chooses Run, so
// a click can never kick off a heavy task by accident.
export async function showActionInfo(store: ShortcutStore, shortcut: Shortcut): Promise<void> {
  const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
  const scheduled = shortcut.schedule?.atTime
    ? l10n("recipe.info.scheduled", { time: shortcut.schedule.atTime })
    : "";
  // Lead the modal with the recipe's own description (what it does + what it was
  // detected from) when present, so the catalog prose is surfaced on click; the
  // concrete action line and any schedule note follow it.
  const detail = [shortcut.description, describeAction(shortcut), scheduled]
    .filter((part) => Boolean(part))
    .join("\n\n");

  const run = l10n("recipe.info.run");
  const promote = l10n("recipe.info.promote");
  const buttons = shortcut.isRecipe ? [run, promote] : [run];

  const choice = await vscode.window.showInformationMessage(
    l10n("recipe.info.title", { name }),
    { modal: true, detail },
    ...buttons
  );
  if (choice === run) {
    await runShortcutCommand(store, shortcut);
  } else if (choice === promote) {
    await vscode.commands.executeCommand("saropaWorkspace.promoteRecipe", shortcut);
  }
}

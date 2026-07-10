import * as vscode from "vscode";
import { Shortcut, shortcutKind } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { parseArgs, formatArgs } from "./configureRunCommand";
import { l10n } from "../i18n/l10n";

// "Duplicate with Argument" — create a run variant of a file shortcut that runs the
// same script with a different argument line. Two-step prompt: first the argument line
// (pre-filled with the source's current args, so the user edits an existing line rather
// than retypes it), then the new name (defaulting to the base name with the arguments
// suffixed — "setup_arb_translate.py -o" — so a variant is self-describing unless the
// user renames it). The new shortcut points at the same file and inherits the source's
// run config; only the args and the name differ. Store.duplicateShortcut does the copy.

// The source's display name, with a suffix that merely echoes its OWN current args
// stripped off, so duplicating a duplicate does not compound the suffix:
// "script.py -o" (args ["-o"]) + new args "-o --force" -> base "script.py" ->
// "script.py -o --force", not "script.py -o -o --force". Falls back to the label /
// basename when there is no such suffix to strip.
function baseNameFor(shortcut: Shortcut): string {
  const basename = shortcut.path.split("/").pop() ?? shortcut.path;
  const display = shortcut.label ?? basename;
  const currentArgs = shortcut.exec?.args ?? [];
  if (currentArgs.length > 0) {
    const suffix = ` ${formatArgs(currentArgs)}`;
    if (display.endsWith(suffix)) {
      return display.slice(0, display.length - suffix.length);
    }
  }
  return display;
}

// "Duplicate with Argument" command entry point. Only meaningful for a file shortcut
// (a url/shell/command action has no argument line), so warns and exits otherwise.
// Prompts for the new argument line (pre-filled with the source's current args) then a
// default name (base name + the entered args, so the variant is self-describing), and
// hands both to store.duplicateShortcut.
export async function duplicateWithArgs(
  store: ShortcutStore,
  shortcut: Shortcut
): Promise<void> {
  // Only a file shortcut runs via an interpreter + argument line; a url/shell/command
  // action stores its target elsewhere, so an "argument" has no meaning there.
  if (shortcutKind(shortcut) !== "file") {
    const name = shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
    vscode.window.showWarningMessage(l10n("duplicateArg.notFile", { name }));
    return;
  }

  // Pre-fill the argument input with ALL of the source's current args, so the user
  // extends/edits the existing line instead of retyping it. Empty when the source has none.
  const argLine = await vscode.window.showInputBox({
    title: l10n("duplicateArg.title"),
    prompt: l10n("duplicateArg.argsPrompt"),
    placeHolder: l10n("duplicateArg.argsPlaceholder"),
    value: formatArgs(shortcut.exec?.args ?? []),
    ignoreFocusOut: true,
  });
  if (argLine === undefined) {
    return;
  }
  const args = parseArgs(argLine);

  // Default the name to the base name with the entered arguments suffixed, so a fresh
  // variant reads as "setup_arb_translate.py -o" unless the user overtypes it. The raw
  // trimmed input (not re-formatted args) is used so the name mirrors exactly what the
  // user typed.
  const trimmedArgLine = argLine.trim();
  const base = baseNameFor(shortcut);
  const defaultName = trimmedArgLine.length > 0 ? `${base} ${trimmedArgLine}` : base;
  const name = await vscode.window.showInputBox({
    title: l10n("duplicateArg.title"),
    prompt: l10n("duplicateArg.namePrompt"),
    value: defaultName,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().length === 0 ? l10n("duplicateArg.nameEmpty") : undefined,
  });
  if (name === undefined) {
    return;
  }

  const created = await store.duplicateShortcut(shortcut, name, args);
  if (created) {
    vscode.window.showInformationMessage(
      l10n("duplicateArg.created", { name: name.trim() })
    );
  } else {
    // The store returns false only when the source is no longer in its store — a race
    // where the shortcut was removed between opening the menu and confirming. Emit a
    // visible outcome rather than returning silently (the no-silent-async rule).
    vscode.window.showWarningMessage(
      l10n("duplicateArg.failed", {
        name: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
      })
    );
  }
}

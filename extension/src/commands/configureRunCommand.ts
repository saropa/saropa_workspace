import * as vscode from "vscode";
import { ShortcutExecConfig } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

// The command-prefix and argument-line editors for the run-parameters hub, plus the
// command-line parse/format pair they share with the run-with-overrides palette.
// Split out of configureRun.ts so the hub file holds the flow and these field
// editors live with the parsing they depend on.

export async function editCommand(work: ShortcutExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.command.prompt"),
    placeHolder: l10n("configure.command.placeholder"),
    value: work.command ?? "",
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    // Esc on the sub-step: leave the field unchanged.
    return;
  }
  // An empty entry means "use the interpreter default for this file type".
  work.command = value.trim() === "" ? undefined : value;
}

// Argument-line sub-editor: pre-fills the input with the current args formatted as a
// command line, then re-parses whatever the user enters on confirm. Esc leaves the
// field unchanged; an empty result clears it to undefined (round-trip parity).
export async function editArgs(work: ShortcutExecConfig, title: string): Promise<void> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: l10n("configure.args.prompt"),
    placeHolder: l10n("configure.args.placeholder"),
    value: work.args ? formatArgs(work.args) : "",
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  const parsed = parseArgs(value);
  work.args = parsed.length > 0 ? parsed : undefined;
}

// Split a command-line string into args, honoring double-quoted spans so an
// argument with spaces survives the round trip through the input box. Exported so
// the run-with-overrides palette parses an edited argument line the same way.
export function parseArgs(line: string): string[] {
  const out: string[] = [];
  const token = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(line)) !== null) {
    out.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return out;
}

// Inverse of parseArgs: quote any arg containing whitespace so the displayed and
// re-parsed forms agree. Exported alongside parseArgs for the overrides palette.
export function formatArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

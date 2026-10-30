import * as path from "node:path";
import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { CopyMode, DEFAULT_TERMINAL_COMMAND, HANDOFF_DIR, HandoffFormat, asCopyMode, handoffFile, joinHandoffs, referralLine, staleHandoffFiles, terminalCommand } from "../board/handoff";

// Release Board, hand-off: writes the finished document to the project's hand-off folder and
// delivers it: a copied line, the whole text, or a command in a terminal. Local only: nothing
// is sent anywhere by the board itself.

// The two hand-off settings, already checked.
export interface HandoffSettings {
  terminalCommand: string;
  copyMode: CopyMode;
}

// Reads the hand-off settings; a bad value falls back to its default.
export function readHandoffSettings(): HandoffSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.handoff");
  return { terminalCommand: String(c.get<string>("terminalCommand", DEFAULT_TERMINAL_COMMAND) ?? "").trim() || DEFAULT_TERMINAL_COMMAND, copyMode: asCopyMode(c.get<string>("copyMode", "referral")) };
}

// The finished document in both formats, with the project folder it is saved in.
export interface HandoffFiles {
  root: vscode.Uri;
  id: string;
  markdown: string;
  json: string;
}

// Writes the Markdown and JSON files and a .gitignore that keeps the folder out of git, then
// removes the files of older hand-offs beyond the newest twenty.
export async function saveHandoff(h: HandoffFiles): Promise<void> {
  const dir = vscode.Uri.joinPath(h.root, HANDOFF_DIR);
  const write = (name: string, text: string): Thenable<void> => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), Buffer.from(text, "utf8"));
  await vscode.workspace.fs.createDirectory(dir);
  await write(".gitignore", "*\n");
  await write(`${h.id}.md`, h.markdown);
  await write(`${h.id}.json`, h.json);
  try {
    const names = (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name);
    await Promise.all(staleHandoffFiles(names).map((name) => vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, name))));
  } catch {
    // Pruning is best effort: a file that cannot be removed stays.
  }
}

export type HandoffAct = "copy" | "copyFull" | "save" | "terminal";

// What an action did: one word for the page, and the detail for its tooltip.
export interface HandoffResult {
  word: string;
  tip: string;
}

// The path of a hand-off file as seen from the first project's folder: project-relative for the
// first project, "../other/.saropa/..." for the others (the terminal runs in the first folder).
const fileFrom = (first: HandoffFiles, f: HandoffFiles, format: HandoffFormat): string => (f === first ? handoffFile(f.id, format) : `${path.posix.relative(first.root.path, f.root.path)}/${handoffFile(f.id, format)}`);

// Saves the documents (one per project), then does the action. Copy follows the copy mode
// setting; Copy full text always copies the whole text. The terminal runs in the first project's folder.
export async function deliver(act: HandoffAct, files: HandoffFiles[], format: HandoffFormat, settings: HandoffSettings): Promise<HandoffResult> {
  const first = files[0];
  for (const f of files) {
    await saveHandoff(f);
  }
  if (act === "save") {
    return { word: l10n("releaseBoard.handoff.saved"), tip: l10n("releaseBoard.handoff.savedTip", { file: files.map((f) => fileFrom(first, f, "md")).join(", ") }) };
  }
  if (act === "terminal") {
    const command = terminalCommand(settings.terminalCommand, first.id, files.map((f) => fileFrom(first, f, "md")));
    const terminal = vscode.window.createTerminal({ name: l10n("releaseBoard.handoff.terminalName"), cwd: first.root });
    terminal.show();
    terminal.sendText(command);
    return { word: l10n("releaseBoard.handoff.started"), tip: l10n("releaseBoard.handoff.startedTip", { command }) };
  }
  const full = act === "copyFull" || settings.copyMode === "full";
  const text = full ? joinHandoffs(files, format) : referralLine(files.map((f) => fileFrom(first, f, format)));
  await vscode.env.clipboard.writeText(text);
  return { word: l10n("releaseBoard.handoff.copied"), tip: full ? l10n("releaseBoard.handoff.copiedFullTip") : l10n("releaseBoard.handoff.copiedTip", { line: text }) };
}

import * as path from "node:path";
import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";
import { pathExists } from "./boardFileSource";
import { isLink } from "./boardRuleAssign";
import { writeFileSafe } from "./boardWrite";
import { CopyMode, DEFAULT_TERMINAL_COMMAND, HANDOFF_DIR, HandoffFormat, asCopyMode, handoffFile, joinHandoffs, referralLine, staleHandoffFiles, terminalCommand, unsafeCommandPath } from "../board/handoff";

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
// removes the files of older hand-offs beyond the newest twenty. Nothing is written through a symbolic
// link (the .saropa folder, the hand-off folder or a target file); an existing .gitignore with other
// content is kept (a `*` line is added only when it has none); only files named like a hand-off are pruned.
export async function saveHandoff(h: HandoffFiles): Promise<void> {
  const saropa = vscode.Uri.joinPath(h.root, ".saropa");
  const dir = vscode.Uri.joinPath(h.root, HANDOFF_DIR);
  const target = (name: string): vscode.Uri => vscode.Uri.joinPath(dir, name);
  const linked = async (u: vscode.Uri): Promise<boolean> => isLink(u);
  if ((await linked(saropa)) || (await linked(dir))) {
    throw new Error("EPERM: the hand-off folder is a symbolic link");
  }
  const names = [".gitignore", `${h.id}.md`, `${h.id}.json`];
  for (const n of names) {
    if (await linked(target(n))) {
      throw new Error(`EPERM: ${n} is a symbolic link`);
    }
  }
  await vscode.workspace.fs.createDirectory(dir);
  const ignore = target(".gitignore");
  if (!(await pathExists(ignore))) {
    await writeFileSafe(ignore, Buffer.from("*\n", "utf8"));
  } else {
    const text = Buffer.from(await vscode.workspace.fs.readFile(ignore)).toString("utf8");
    if (!text.split(/\r?\n/).some((l) => l.trim() === "*")) {
      await writeFileSafe(ignore, Buffer.from(`${text}${text === "" || text.endsWith("\n") ? "" : "\n"}*\n`, "utf8"));
    }
  }
  await writeFileSafe(target(`${h.id}.md`), Buffer.from(h.markdown, "utf8"));
  await writeFileSafe(target(`${h.id}.json`), Buffer.from(h.json, "utf8"));
  try {
    const found = (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name);
    for (const name of staleHandoffFiles(found)) {
      // staleHandoffFiles only returns names that are a hand-off id plus .md or .json; a link is never followed.
      if (!(await linked(target(name)))) {
        await vscode.workspace.fs.delete(target(name));
      }
    }
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
  if (act === "terminal") {
    const unsafe = unsafeCommandPath(files.slice(1).map((f) => fileFrom(first, f, "md")));
    if (unsafe !== undefined) {
      return { word: l10n("releaseBoard.handoff.unsafe"), tip: l10n("releaseBoard.handoff.unsafeTip", { file: unsafe }) };
    }
  }
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

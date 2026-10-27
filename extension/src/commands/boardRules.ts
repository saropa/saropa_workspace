import * as vscode from "vscode";
import { globToRegExp } from "../board/glob";
import { l10n } from "../i18n/l10n";
import { RULES_FILE } from "./boardConfigLoad";
import { pathExists } from "./boardFileSource";
import { BoardRun } from "./boardScanStore";

// Release Board, working on the rules file: open it (creating a small one first) and check
// a glob against the scanned documents before a rule is written.

const RULES_TEMPLATE = `{
  "version": 1,
  "profile": "deliberate",
  "pinned": [],
  "groups": []
}
`;

// Opens the user's rules file, creating a small one first when there is none. With a
// project id and folder it moves to that project in the file when the file names it, and
// says which folder needs a rule.
export async function openRulesFile(at?: { project: string; folder: string }, viewColumn?: number): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, RULES_FILE);
  if (!(await pathExists(uri))) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".saropa"));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(RULES_TEMPLATE, "utf8"));
    void vscode.window.showInformationMessage(l10n("releaseBoard.rulesCreated", { file: RULES_FILE }));
  }
  const editor = await vscode.window.showTextDocument(uri, viewColumn === undefined ? undefined : { viewColumn });
  if (at) {
    const text = editor.document.getText();
    const i = text.indexOf(JSON.stringify(at.project));
    if (i >= 0) {
      const pos = editor.document.positionAt(i);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
    void vscode.window.showInformationMessage(l10n("releaseBoard.ruleFor", { folder: at.folder ? `${at.folder}/**` : "/" }));
  }
}

// The scanned rows a glob matches. It matches the path inside each project, like a rule
// does, or the path with its project in front.
export function globHits(rows: BoardRun["result"]["rows"], glob: string): BoardRun["result"]["rows"] {
  const re = globToRegExp(glob);
  return rows.filter((r) => re.test(r.path) || re.test(r.project + "/" + r.path));
}

// Asks for a glob and reports how many documents it matches, so a rule can be checked
// before it is written. `scan` runs the board scan.
export async function previewGlob(scan: () => Promise<BoardRun | undefined>): Promise<void> {
  const glob = await vscode.window.showInputBox({ prompt: l10n("releaseBoard.previewPrompt") });
  if (!glob) {
    return;
  }
  const run = await scan();
  if (!run) {
    return;
  }
  const hits = globHits(run.result.rows, glob);
  void vscode.window.showInformationMessage(
    hits.length === 0
      ? l10n("releaseBoard.previewNone", { glob })
      : l10n("releaseBoard.previewResult", { count: hits.length, glob, sample: hits.slice(0, 5).map((h) => h.path).join(", ") })
  );
}

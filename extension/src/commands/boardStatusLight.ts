import * as vscode from "vscode";
import { Light } from "../board/boardModel";
import { worstLight } from "../board/sidebar";
import { l10n } from "../i18n/l10n";
import { currentBoard, onDidChangeBoard, staleNote } from "../views/boardFeed";

// Tints the status bar button with the worst light of all projects and names it in the
// tooltip. Red and amber use the status bar's own backgrounds; green and no result use the
// plain button, with a green text color for GO.
const WORDS: Record<Light, string> = { "no-go": "releaseBoard.panel.noGo", unverified: "releaseBoard.panel.unverified", go: "releaseBoard.panel.go" };

export function bindStatusLight(button: vscode.StatusBarItem): vscode.Disposable {
  const apply = (): void => {
    const show = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("statusBar.showLight", true);
    const worst = show ? worstLight(currentBoard()?.model.projects.map((p) => p.light) ?? []) : undefined;
    const base = l10n("releaseBoard.statusBarTooltip");
    button.backgroundColor = worst === "no-go" ? new vscode.ThemeColor("statusBarItem.errorBackground") : worst === "unverified" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    button.color = worst === "go" ? new vscode.ThemeColor("charts.green") : undefined;
    const note = worst ? staleNote() : undefined;
    button.tooltip = worst ? [l10n(WORDS[worst]), ...(note ? [note] : []), base].join("\n") : base;
  };
  apply();
  return vscode.Disposable.from(
    onDidChangeBoard(apply),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("saropaWorkspace.releaseBoard.statusBar") && apply())
  );
}

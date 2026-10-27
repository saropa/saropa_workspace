import * as vscode from "vscode";
import { Light } from "../board/boardModel";
import { worstLight } from "../board/sidebar";
import { l10n } from "../i18n/l10n";
import { currentBoard, onDidChangeBoard, staleNote } from "../views/boardFeed";
import { currentChange, onDidChangeSinceLast, sidebarLines, whenText } from "../views/boardSinceLast";

// Tints the status bar button with the worst light of all projects and names it in the
// tooltip. Red and amber use the status bar's own backgrounds; green and no result use the
// plain button, with a green text color for GO.
const WORDS: Record<Light, string> = { "no-go": "releaseBoard.panel.noGo", unverified: "releaseBoard.panel.unverified", go: "releaseBoard.panel.go" };

// The tooltip: the light in words, the stale note, what changed since the last look, then
// the plain tooltip. With no light it is the plain tooltip only.
export function lightTooltip(worst: Light | undefined, note: string | undefined, since: string[], base: string): string {
  return worst ? [l10n(WORDS[worst]), ...(note ? [note] : []), ...since, base].join("\n") : base;
}

// Keeps the button's tint and tooltip in step with the published board, the since-last
// change and the status bar settings. Dispose the result to stop.
export function bindStatusLight(button: vscode.StatusBarItem): vscode.Disposable {
  const apply = (): void => {
    const show = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("statusBar.showLight", true);
    const worst = show ? worstLight(currentBoard()?.model.projects.map((p) => p.light) ?? []) : undefined;
    button.backgroundColor = worst === "no-go" ? new vscode.ThemeColor("statusBarItem.errorBackground") : worst === "unverified" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    button.color = worst === "go" ? new vscode.ThemeColor("charts.green") : undefined;
    // What changed since the board was last seen, one line per project.
    const change = worst ? currentChange() : undefined;
    const since = change ? [l10n("releaseBoard.sinceLast.heading", { time: whenText(change.since) }), ...sidebarLines(change).map((l) => l.text)] : [];
    button.tooltip = lightTooltip(worst, worst ? staleNote() : undefined, since, l10n("releaseBoard.statusBarTooltip"));
  };
  apply();
  return vscode.Disposable.from(
    onDidChangeBoard(apply),
    onDidChangeSinceLast(apply),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("saropaWorkspace.releaseBoard.statusBar") && apply())
  );
}

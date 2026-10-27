import * as vscode from "vscode";
import { Light } from "../board/boardModel";
import { boardLights, worstLight } from "../board/sidebar";
import { SkippedProject } from "../board/types";
import { MAX_EXTRA_PROJECTS } from "../board/extraProjects";
import { l10n } from "../i18n/l10n";
import { currentBoard, onDidChangeBoard, staleNote } from "../views/boardFeed";
import { currentChange, onDidChangeSinceLast, sidebarLines, whenText } from "../views/boardSinceLast";

// Tints the status bar button with the worst light of all projects and names it in the
// tooltip. Red and amber use the status bar's own backgrounds; green and no result use the
// plain button, with a green text color for GO.
const WORDS: Record<Light, string> = { "no-go": "releaseBoard.panel.noGo", unverified: "releaseBoard.panel.unverified", go: "releaseBoard.panel.go" };

// The tooltip: the light in words, the stale note, what changed since the last look, then
// the plain tooltip. With no light it is the plain tooltip only.
export function lightTooltip(worst: Light | undefined, note: string | undefined, since: string[], base: string, umbrella: string[] = []): string {
  return worst ? [l10n(WORDS[worst]), ...umbrella, ...(note ? [note] : []), ...since, base].join("\n") : base;
}

// Lines for the umbrella view: each chosen folder that could not be read, and how many
// chosen projects are hidden.
export function umbrellaLines(skipped: readonly SkippedProject[] | undefined, hidden: number | undefined): string[] {
  return [
    ...(skipped ?? []).map((s) => l10n("releaseBoard.statusBarNotRead", { name: s.name, reason: l10n(`releaseBoard.projects.label.skip_${s.reason}`, { max: MAX_EXTRA_PROJECTS }) })),
    ...(hidden && hidden > 0 ? [l10n("releaseBoard.projects.label.hidden", { count: hidden })] : []),
  ];
}

// Keeps the button's tint and tooltip in step with the published board, the since-last
// change and the status bar settings. Dispose the result to stop.
export function bindStatusLight(button: vscode.StatusBarItem): vscode.Disposable {
  const apply = (): void => {
    const show = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("statusBar.showLight", true);
    const model = currentBoard()?.model;
    const worst = show && model ? worstLight(boardLights(model)) : undefined;
    button.backgroundColor = worst === "no-go" ? new vscode.ThemeColor("statusBarItem.errorBackground") : worst === "unverified" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    button.color = worst === "go" ? new vscode.ThemeColor("charts.green") : undefined;
    // What changed since the board was last seen, one line per project.
    const change = worst ? currentChange() : undefined;
    const since = change ? [l10n("releaseBoard.sinceLast.heading", { time: whenText(change.since) }), ...sidebarLines(change).map((l) => l.text)] : [];
    button.tooltip = lightTooltip(worst, worst ? staleNote() : undefined, since, l10n("releaseBoard.statusBarTooltip"), worst ? umbrellaLines(model?.skipped, model?.hidden) : []);
  };
  apply();
  return vscode.Disposable.from(
    onDidChangeBoard(apply),
    onDidChangeSinceLast(apply),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("saropaWorkspace.releaseBoard.statusBar") && apply())
  );
}

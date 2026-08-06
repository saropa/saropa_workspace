import * as vscode from "vscode";
import type { RoutineBrief } from "../exec/routineRunner";
import { validateReportPath } from "../exec/trendReports";
import { openReport } from "../exec/reportOpen";
import { renderBriefShell, briefUiStrings } from "./brief/briefShell";
import { l10n } from "../i18n/l10n";

// Single-instance webview panel for the Morning Brief — the designed briefing
// screen that replaces the raw markdown preview after a routine run. Follows
// DashboardPanel's lifecycle exactly: static `current`, `show()` reveals or
// creates, disposables array, message narrowing with path re-validation.
export class BriefPanel {
  private static current: BriefPanel | undefined;
  private static readonly viewType = "saropaWorkspace.morningBrief";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(brief: RoutineBrief): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (BriefPanel.current) {
      BriefPanel.current.panel.reveal(column);
      BriefPanel.current.postBrief(brief);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      BriefPanel.viewType,
      l10n("brief.title"),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false }
    );
    BriefPanel.current = new BriefPanel(panel, brief);
  }

  private constructor(panel: vscode.WebviewPanel, brief: RoutineBrief) {
    this.panel = panel;
    this.panel.webview.html = renderBriefShell();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );

    // Post once the script is mounted — a short defer so the listener is
    // attached before the data arrives (same pattern as dashboard).
    setTimeout(() => this.postBrief(brief), 50);
  }

  private postBrief(brief: RoutineBrief): void {
    void this.panel.webview.postMessage({
      type: "briefData",
      brief,
      strings: briefUiStrings(),
    });
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; path?: string };
    if (msg.type === "openReport") {
      const validated = validateReportPath(msg.path);
      if (validated) {
        await openReport(validated);
      }
    }
  }

  private dispose(): void {
    BriefPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import type { RoutineBrief } from "../exec/routineRunner";
import { validateReportPath } from "../exec/trendReports";
import { openReport } from "../exec/reportOpen";
import { renderBriefShell, briefUiStrings } from "./brief/briefShell";
import { renderBriefExportHtml, renderBriefMarkdown } from "./brief/briefExport";
import { l10n } from "../i18n/l10n";

// Text of a caught error for the user-facing toasts; non-Error throws are stringified.
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// Single-instance webview panel for the Morning Brief — the designed briefing
// screen that replaces the raw markdown preview after a routine run. Follows
// DashboardPanel's lifecycle exactly: static `current`, `show()` reveals or
// creates, disposables array, message narrowing with path re-validation.
export class BriefPanel {
  private static current: BriefPanel | undefined;
  private static readonly viewType = "saropaWorkspace.morningBrief";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private lastBrief: RoutineBrief;

  // Opens the panel, or reuses the open one. A reused panel keeps its tab but gets the new
  // brief, so running a routine twice never stacks two Brief tabs.
  static show(brief: RoutineBrief): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (BriefPanel.current) {
      BriefPanel.current.panel.reveal(column);
      BriefPanel.current.lastBrief = brief;
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
    this.lastBrief = brief;
    this.panel.webview.html = renderBriefShell();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    // No onDidChangeViewState needed: retainContextWhenHidden is false, so a
    // tab-switch destroys and recreates the webview script, which posts "ready"
    // on mount — the ready handler re-sends briefData without a timing race.
  }

  // Sends the brief and the localized strings to the page, which renders both. Strings
  // travel with the data because the page holds no English of its own.
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
    // The page is untrusted input: only these two fields are read, and a path is
    // re-validated by the host before anything is opened.
    const msg = message as { type?: string; path?: string };
    switch (msg.type) {
      case "ready":
        this.postBrief(this.lastBrief);
        return;
      case "openReport": {
        const validated = validateReportPath(msg.path);
        if (validated) {
          await openReport(validated);
        }
        return;
      }
      case "copyMarkdown":
        await this.copyBriefAsMarkdown();
        return;
      case "openInBrowser":
        await this.openBriefInBrowser();
        return;
      case "saveHtml":
        await this.saveBriefAsHtml();
        return;
    }
  }

  // Writes the export HTML to the OS temp folder and opens it in the default browser.
  // The file name carries the brief's date, so a second brief on the same day reuses it.
  private async openBriefInBrowser(): Promise<void> {
    try {
      const html = renderBriefExportHtml(this.lastBrief, briefUiStrings());
      const tmpFile = path.join(
        os.tmpdir(),
        `saropa-brief-${this.lastBrief.generatedAt.slice(0, 10)}.html`
      );
      await fs.writeFile(tmpFile, html, "utf8");
      await vscode.env.openExternal(vscode.Uri.file(tmpFile));
    } catch (err) {
      void vscode.window.showErrorMessage(
        l10n("brief.openInBrowserFailed", { error: errorMessage(err) })
      );
    }
  }

  // Puts a Markdown version of the brief on the clipboard, for pasting into chat or an issue.
  private async copyBriefAsMarkdown(): Promise<void> {
    try {
      const md = renderBriefMarkdown(this.lastBrief, briefUiStrings());
      await vscode.env.clipboard.writeText(md);
      void vscode.window.showInformationMessage(l10n("brief.copied"));
    } catch (err) {
      void vscode.window.showErrorMessage(
        l10n("brief.copyFailed", { error: errorMessage(err) })
      );
    }
  }

  // Asks where to save the export HTML (default: the first workspace folder) and writes
  // it there. Cancelling the dialog does nothing and shows no error.
  private async saveBriefAsHtml(): Promise<void> {
    const defaultName = `morning-brief-${this.lastBrief.generatedAt.slice(0, 10)}.html`;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceRoot
      ? vscode.Uri.joinPath(workspaceRoot, defaultName)
      : vscode.Uri.file(defaultName);
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { HTML: ["html"] },
    });
    if (!uri) {
      return;
    }
    try {
      const html = renderBriefExportHtml(this.lastBrief, briefUiStrings());
      await fs.writeFile(uri.fsPath, html, "utf8");
      void vscode.window.showInformationMessage(
        l10n("brief.saved", { path: uri.fsPath })
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        l10n("brief.saveFailed", { error: errorMessage(err) })
      );
    }
  }

  // Clears the single-instance reference first so a later show() creates a fresh panel.
  private dispose(): void {
    BriefPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

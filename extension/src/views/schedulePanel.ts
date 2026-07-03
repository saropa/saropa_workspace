import * as vscode from "vscode";
import * as crypto from "crypto";
import * as path from "path";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut } from "../model/shortcut";
import { nextOccurrence, isMissed } from "../exec/schedule";
import { runStatusRegistry } from "../exec/runStatus";
import { validateReportPath } from "../exec/trendReports";
import { firstWorkspacePath } from "../exec/actionRunner";
import { l10n } from "../i18n/l10n";
import { formatWhen } from "./scheduleStatusBar";
import { SCHEDULE_STYLE, SCHEDULE_SCRIPT } from "./schedulePanelAssets";

// The "Saropa Schedule" webview — one screen that lists every shortcut with an
// enabled schedule, each with its next run, last outcome (success / failure /
// overdue / never), and a one-click "Open report" link to the report its last run
// wrote. It answers "what is scheduled, did it run, and how did it go?" — the gap the
// per-item Schedule editor (which only SETS one item's timing) and the single-line
// status bar (which shows only the soonest run) leave open.
//
// Local-only and safe: a strict CSP with a per-load nonce, no remote or bundled
// resource, themed via --vscode-* variables. The only mutating actions are opening a
// report (its path re-validated against reports/ first) and running a scheduled item
// on demand (through the same runPin command the tree uses). Single instance: a
// second invocation reveals the existing panel; all disposables tear down together.
//
// A row's last outcome is read first from the durable per-schedule record
// (lastOutcome/lastReportPath, persisted across reloads by the scheduler) and falls
// back to the session-only runStatusRegistry, so an outcome shows whether it came
// from a prior session or this one.
export class SchedulePanel {
  private static current: SchedulePanel | undefined;
  private static readonly viewType = "saropaWorkspace.schedulePanel";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly store: ShortcutStore;

  static show(context: vscode.ExtensionContext, store: ShortcutStore): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (SchedulePanel.current) {
      SchedulePanel.current.panel.reveal(column);
      void SchedulePanel.current.loadRows();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SchedulePanel.viewType,
      l10n("schedulePanel.title"),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    SchedulePanel.current = new SchedulePanel(panel, store);
  }

  private constructor(panel: vscode.WebviewPanel, store: ShortcutStore) {
    this.panel = panel;
    this.store = store;
    this.panel.webview.html = this.renderShell();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    // Repaint on a fire (a recorded outcome) or a schedule edit, so the screen stays
    // live without a manual refresh. Both fire often enough to be debounce-free here.
    this.disposables.push(runStatusRegistry.onDidChange(() => void this.loadRows()));
    this.disposables.push(this.store.onDidChange(() => void this.loadRows()));
    // No eager load: the webview posts "ready" once mounted, which triggers the first
    // load (avoids a post-before-listener race).
  }

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as { type?: string; path?: string; id?: string };
    switch (msg.type) {
      case "ready":
      case "refresh":
        await this.loadRows();
        return;
      case "openReport":
        await this.openReport(msg.path);
        return;
      case "runScheduled":
        await this.runScheduled(msg.id);
        return;
    }
  }

  // Build one display row per shortcut with an enabled schedule and post them,
  // overdue-first then soonest-next-run. The report path is resolved to an absolute
  // path here (the webview never sees a raw path it could tamper with beyond the
  // host's re-validation on openReport).
  private async loadRows(): Promise<void> {
    const now = Date.now();
    const root = firstWorkspacePath();
    const shortcuts = [
      ...this.store.getProjectShortcuts(),
      ...this.store.getGlobalShortcuts(),
    ];
    const rows = shortcuts
      .filter((s) => s.schedule?.enabled)
      .map((s) => this.buildRow(s, now, root))
      .sort((a, b) => this.sortKey(a) - this.sortKey(b));
    void this.panel.webview.postMessage({ type: "rows", rows });
  }

  private buildRow(
    shortcut: Shortcut,
    now: number,
    root: string | undefined
  ): ScheduleRow {
    // schedule presence is guaranteed by the enabled filter in loadRows.
    const schedule = shortcut.schedule as NonNullable<Shortcut["schedule"]>;
    const next = nextOccurrence(schedule, now);
    // Durable record wins; the session registry is the in-memory fallback.
    const sessionResult = runStatusRegistry.get(shortcut.id);
    const outcome = schedule.lastOutcome ?? sessionResult?.outcome ?? null;
    const lastRun = schedule.lastRun;
    const reportPath =
      schedule.lastReportPath && root
        ? path.join(root, ...schedule.lastReportPath.split("/"))
        : undefined;
    return {
      id: shortcut.id,
      name: shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path),
      scope: shortcut.scope,
      next: next !== undefined ? formatWhen(next) : "",
      overdue: isMissed(schedule, now),
      outcome,
      lastAgo: lastRun !== undefined ? this.relativeTime(now, lastRun) : null,
      reportPath,
      catchUp: schedule.catchUp === true,
    };
  }

  // Sort weight: overdue rows first (0), then by soonest next run; a row with no next
  // run sinks to the bottom.
  private sortKey(row: ScheduleRow): number {
    if (row.overdue) {
      return -1;
    }
    return row.next ? 0 : 1;
  }

  // Open the report a scheduled run wrote, re-validating the path against the
  // workspace reports/ folder so a crafted or stale message cannot open an arbitrary
  // file (the same guard the Dashboard uses).
  private async openReport(candidate?: string): Promise<void> {
    const safe = validateReportPath(candidate);
    if (!safe) {
      vscode.window.showWarningMessage(l10n("schedulePanel.reportGone"));
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(safe));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  // Run a scheduled item on demand through the same command the tree's Run uses, so a
  // "Run now" from this screen behaves exactly like a manual run (feedback, badges,
  // and outcome recording all go through one path). The screen repaints via the
  // runStatusRegistry / store change subscriptions when the run completes.
  private async runScheduled(id?: string): Promise<void> {
    if (!id) {
      return;
    }
    const shortcut = this.store.findShortcut(id);
    if (!shortcut) {
      vscode.window.showWarningMessage(l10n("schedulePanel.itemGone"));
      return;
    }
    await vscode.commands.executeCommand("saropaWorkspace.runPin", shortcut);
  }

  // Compact "time ago", reusing the Project Files view's wording so relative times
  // read the same across the extension.
  private relativeTime(now: number, then: number): string {
    const minutes = Math.floor(Math.max(0, now - then) / 60000);
    if (minutes < 1) {
      return l10n("projectFiles.justNow");
    }
    if (minutes < 60) {
      return l10n("projectFiles.minutesAgo", { count: minutes });
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return l10n("projectFiles.hoursAgo", { count: hours });
    }
    return l10n("projectFiles.daysAgo", { count: Math.floor(hours / 24) });
  }

  // The static HTML shell: a strict CSP locked to this nonce for scripts and to the
  // webview's own inline styles, no remote anything. Localized strings the client
  // renders are injected as a STRINGS object so no English is hardcoded in the client.
  private renderShell(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const strings = JSON.stringify(this.uiStrings());
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${l10n("schedulePanel.title")}</title>
<style>${SCHEDULE_STYLE}</style>
</head>
<body>
<header>
  <span class="title">${l10n("schedulePanel.heading")}</span>
  <button id="refresh" class="secondary">${l10n("schedulePanel.refresh")}</button>
</header>
<div id="rows"></div>
<script nonce="${nonce}">const STRINGS = ${strings};
${SCHEDULE_SCRIPT}</script>
</body>
</html>`;
  }

  private uiStrings(): Record<string, string> {
    return {
      empty: l10n("schedulePanel.empty"),
      overdue: l10n("schedulePanel.overdue"),
      ok: l10n("schedulePanel.ok"),
      failed: l10n("schedulePanel.failed"),
      never: l10n("schedulePanel.never"),
      nextLabel: l10n("schedulePanel.nextLabel"),
      noNext: l10n("schedulePanel.noNext"),
      lastLabel: l10n("schedulePanel.lastLabel"),
      neverRun: l10n("schedulePanel.neverRun"),
      openReport: l10n("schedulePanel.openReport"),
      runNow: l10n("schedulePanel.runNow"),
      scopeGlobal: l10n("schedulePanel.scopeGlobal"),
      scopeProject: l10n("schedulePanel.scopeProject"),
      catchUpOn: l10n("schedulePanel.catchUpOn"),
    };
  }

  private dispose(): void {
    SchedulePanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// One display row the webview renders. Report path is absolute (host-resolved) and
// re-validated on open; the webview only echoes it back.
interface ScheduleRow {
  id: string;
  name: string;
  scope: "project" | "global";
  next: string;
  overdue: boolean;
  outcome: "success" | "failure" | null;
  lastAgo: string | null;
  reportPath: string | undefined;
  catchUp: boolean;
}

import * as vscode from "vscode";
import { SystemEventName } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { runStatusRegistry } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";
import { buildData } from "./plannerPanelData";
import { renderShell } from "./plannerPanelShell";
import {
  LAYOUT_KEY,
  runById,
  openById,
  runCommandForShortcut,
  toggleEnabled,
  retime,
  addTrigger,
  removeTrigger,
  savePositions,
} from "./plannerPanelMessages";

// The Schedule & Workflow Planner webview — the visual home for the three
// automation surfaces a tree cannot express (WOW: chaining + flexible schedules +
// special events). It has three views, all driven from one graph payload:
//   - Day timeline: every daily-scheduled shortcut on a 24-hour ruler, plus the
//     interval shortcuts as cadence chips.
//   - Week planner: a 7-day x 24-hour calendar; drag a scheduled shortcut to retime
//     it or move it to another weekday (writes the schedule, re-arms the scheduler).
//   - Workflow graph: shortcuts and synthetic event nodes wired by their triggers;
//     drag a node's plug to another shortcut to chain them, drag a toolbox event onto
//     a shortcut, or right-click for a searchable link builder.
//
// Local-only and safe: a strict CSP with a per-load nonce, no remote/bundled
// resource, themed entirely via --vscode-* variables. Every mutating message is a
// deliberate, named user gesture that routes through the same store methods and Run
// command the tree uses. Single instance: a second open reveals the existing panel.
// Node positions persist in workspaceState so a hand-arranged graph stays put.
//
// The message protocol handlers, the graph-data builder, and the HTML shell each
// live in their own sibling module (plannerPanelMessages.ts, plannerPanelData.ts,
// plannerPanelShell.ts) as pure functions of the store/context; this class stays a
// thin lifecycle + dispatch shell around them.

export class PlannerPanel {
  private static current: PlannerPanel | undefined;
  private static readonly viewType = "saropaWorkspace.planner";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, store: ShortcutStore): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (PlannerPanel.current) {
      PlannerPanel.current.panel.reveal(column);
      void PlannerPanel.current.push();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PlannerPanel.viewType,
      l10n("planner.title"),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    PlannerPanel.current = new PlannerPanel(panel, context, store);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly store: ShortcutStore
  ) {
    this.panel = panel;
    this.panel.webview.html = renderShell();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    // Repaint whenever the shortcut set changes (a schedule edit, a new trigger, a run
    // result) so the graph stays in sync with the tree and the QuickPick editors.
    this.disposables.push(
      this.store.onDidChange(() => void this.push()),
      runStatusRegistry.onDidChange(() => void this.push())
    );
  }

  // ---- message protocol -------------------------------------------------

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as {
      type?: string;
      id?: string;
      to?: string;
      from?: string;
      kind?: "pin" | "event";
      event?: SystemEventName;
      atTime?: string;
      fromDay?: number;
      toDay?: number;
      positions?: Record<string, { x: number; y: number }>;
    };
    switch (msg.type) {
      case "ready":
      case "refresh":
        await this.push();
        return;
      case "run":
        await runById(this.store, msg.id);
        return;
      case "open":
        await openById(this.store, msg.id);
        return;
      case "configureSchedule":
        await runCommandForShortcut(
          this.store,
          "saropaWorkspace.configureSchedule",
          msg.id,
          () => this.push()
        );
        return;
      case "configureTriggers":
        await runCommandForShortcut(
          this.store,
          "saropaWorkspace.configureTriggers",
          msg.id,
          () => this.push()
        );
        return;
      case "toggleEnabled":
        await toggleEnabled(this.store, msg.id);
        return;
      case "retime":
        await retime(this.store, msg.id, msg.atTime, msg.fromDay, msg.toDay);
        return;
      case "addTrigger":
        await addTrigger(this.store, msg.to, msg.kind, msg.from, msg.event);
        return;
      case "removeTrigger":
        await removeTrigger(this.store, msg.to, msg.from);
        return;
      case "savePositions":
        await savePositions(this.context, msg.positions);
        return;
    }
  }

  // ---- graph build + push ----------------------------------------------

  private async push(): Promise<void> {
    const data = buildData(this.store);
    const positions =
      this.context.workspaceState.get<Record<string, { x: number; y: number }>>(
        LAYOUT_KEY
      ) ?? {};
    const now = new Date();
    await this.panel.webview.postMessage({
      type: "data",
      data,
      positions,
      nowMin: now.getHours() * 60 + now.getMinutes(),
    });
  }

  private dispose(): void {
    PlannerPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

import * as vscode from "vscode";
import * as crypto from "crypto";
import {
  Pin,
  PinKind,
  pinKind,
  PinSchedule,
  PinTrigger,
  SystemEventName,
} from "../model/pin";
import { PinStore } from "../model/pinStore";
import { runStatusRegistry } from "../exec/runStatus";
import { isRunnable } from "../exec/runner";
import { PLANNER_STYLE, PLANNER_SCRIPT } from "./plannerAssets";
import { l10n } from "../i18n/l10n";

// The Schedule & Workflow Planner webview — the visual home for the three
// automation surfaces a tree cannot express (WOW: chaining + flexible schedules +
// special events). It has three views, all driven from one graph payload:
//   - Day timeline: every daily-scheduled pin on a 24-hour ruler, plus the
//     interval pins as cadence chips.
//   - Week planner: a 7-day x 24-hour calendar; drag a scheduled pin to retime it
//     or move it to another weekday (writes the schedule, re-arms the scheduler).
//   - Workflow graph: pins and synthetic event nodes wired by their triggers; drag
//     a node's plug to another pin to chain them, drag a toolbox event onto a pin,
//     or right-click for a searchable link builder.
//
// Local-only and safe: a strict CSP with a per-load nonce, no remote/bundled
// resource, themed entirely via --vscode-* variables. Every mutating message is a
// deliberate, named user gesture that routes through the same store methods and Run
// command the tree uses. Single instance: a second open reveals the existing panel.
// Node positions persist in workspaceState so a hand-arranged graph stays put.

interface PlannerNode {
  id: string;
  kind: "pin" | "event";
  label: string;
  // pin-only fields
  scope?: "project" | "global";
  pinKind?: PinKind;
  // The recipe's own prose (what it does + what it was detected from), surfaced as
  // the detail strip's INFO tip so a seeded/paused recipe explains itself in place.
  description?: string;
  schedule?: PinSchedule;
  emits?: SystemEventName[];
  runnable?: boolean;
  lastOutcome?: "success" | "failure";
  // event-only field
  event?: SystemEventName;
}

interface PlannerEdge {
  from: string;
  to: string;
  kind: "pin" | "event";
}

interface PlannerData {
  nodes: PlannerNode[];
  edges: PlannerEdge[];
}

const LAYOUT_KEY = "saropaWorkspace.planner.layout";

export class PlannerPanel {
  private static current: PlannerPanel | undefined;
  private static readonly viewType = "saropaWorkspace.planner";

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, store: PinStore): void {
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
    private readonly store: PinStore
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderShell();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
    // Repaint whenever the pin set changes (a schedule edit, a new trigger, a run
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
        await this.runById(msg.id);
        return;
      case "open":
        await this.openById(msg.id);
        return;
      case "configureSchedule":
        await this.runCommandForPin("saropaWorkspace.configureSchedule", msg.id);
        return;
      case "configureTriggers":
        await this.runCommandForPin("saropaWorkspace.configureTriggers", msg.id);
        return;
      case "toggleEnabled":
        await this.toggleEnabled(msg.id);
        return;
      case "retime":
        await this.retime(msg.id, msg.atTime, msg.fromDay, msg.toDay);
        return;
      case "addTrigger":
        await this.addTrigger(msg.to, msg.kind, msg.from, msg.event);
        return;
      case "removeTrigger":
        await this.removeTrigger(msg.to, msg.from);
        return;
      case "savePositions":
        await this.savePositions(msg.positions);
        return;
    }
  }

  private findStored(id: string | undefined): Pin | undefined {
    if (!id) {
      return undefined;
    }
    return this.store.findPin(id);
  }

  private async runById(id?: string): Promise<void> {
    const pin = this.findStored(id);
    if (pin) {
      await vscode.commands.executeCommand("saropaWorkspace.runPin", pin);
    }
  }

  private async openById(id?: string): Promise<void> {
    const pin = this.findStored(id);
    if (pin) {
      await vscode.commands.executeCommand("saropaWorkspace.openPin", pin);
    }
  }

  private async runCommandForPin(command: string, id?: string): Promise<void> {
    const pin = this.findStored(id);
    if (pin) {
      await vscode.commands.executeCommand(command, pin);
      // The QuickPick editor wrote through the store, which fires onDidChange and
      // repaints; push() explicitly too in case nothing changed (the panel still
      // reflects the latest state).
      await this.push();
    }
  }

  // Toggle a pin's schedule enabled flag in place — the Pause / Resume gesture.
  private async toggleEnabled(id?: string): Promise<void> {
    const pin = this.findStored(id);
    if (!pin?.schedule) {
      return;
    }
    const resumed = !pin.schedule.enabled;
    await this.store.updatePinSchedule(pin, {
      ...pin.schedule,
      enabled: resumed,
    });
    // Name the pin and the new state — the strip's "(paused)" text also updates, but a
    // toast confirms the gesture took and which pin it acted on (no silent async).
    const name = pin.label ?? pin.id;
    vscode.window.showInformationMessage(
      l10n(resumed ? "planner.scheduleResumed" : "planner.schedulePaused", { name })
    );
  }

  // Drag-retime from the Week view: set the daily time, and move the dragged
  // weekday to the drop column. Moving onto a day already in the set just retimes;
  // moving to a new day swaps the dragged day for the target so the gesture reads as
  // "move this run to here". A pin with no day list (every day) keeps firing every
  // day — only its time changes — because dragging one instance should not silently
  // collapse an everyday schedule to a single day.
  private async retime(
    id?: string,
    atTime?: string,
    fromDay?: number,
    toDay?: number
  ): Promise<void> {
    const pin = this.findStored(id);
    if (!pin?.schedule || !atTime) {
      return;
    }
    const schedule: PinSchedule = { ...pin.schedule, atTime };
    const hadDays = pin.schedule.days && pin.schedule.days.length > 0;
    if (
      hadDays &&
      fromDay !== undefined &&
      toDay !== undefined &&
      fromDay !== toDay
    ) {
      const set = new Set(pin.schedule.days);
      set.delete(fromDay);
      set.add(toDay);
      schedule.days = [...set].sort((a, b) => a - b);
    }
    await this.store.updatePinSchedule(pin, schedule);
  }

  // Add a trigger to the TARGET pin (`to`). A pin link records the source pin id; an
  // event link records the event. Deduped so dragging the same link twice is a
  // no-op, and a self-link (a guaranteed loop) is rejected.
  private async addTrigger(
    to?: string,
    kind?: "pin" | "event",
    from?: string,
    event?: SystemEventName
  ): Promise<void> {
    const target = this.findStored(to);
    if (!target) {
      return;
    }
    const triggers = target.triggers ? [...target.triggers] : [];
    if (kind === "pin") {
      if (!from || from === to) {
        return;
      }
      if (
        triggers.some((t) => t.kind === "pin" && t.pinId === from)
      ) {
        return;
      }
      triggers.push({ kind: "pin", pinId: from });
    } else if (kind === "event" && event) {
      if (triggers.some((t) => t.kind === "event" && t.event === event)) {
        return;
      }
      triggers.push({ kind: "event", event });
    } else {
      return;
    }
    await this.store.updatePinTriggers(target, triggers, target.emits);
    const targetName = target.label ?? target.id;
    vscode.window.showInformationMessage(
      l10n("planner.linked", { name: targetName })
    );
  }

  private async removeTrigger(to?: string, from?: string): Promise<void> {
    const target = this.findStored(to);
    if (!target?.triggers || from === undefined) {
      return;
    }
    // `from` is a pin id for a pin trigger, or an event id ("event:build") for an
    // event trigger. An idle trigger has no graph edge, so it can never be the removal
    // target — give it a sentinel that no `from` value matches, leaving it untouched.
    const remaining = target.triggers.filter((t) => {
      const sourceId =
        t.kind === "pin"
          ? t.pinId
          : t.kind === "event"
            ? `event:${t.event}`
            : "idle";
      return sourceId !== from;
    });
    await this.store.updatePinTriggers(target, remaining, target.emits);
  }

  private async savePositions(
    positions?: Record<string, { x: number; y: number }>
  ): Promise<void> {
    if (!positions) {
      return;
    }
    await this.context.workspaceState.update(LAYOUT_KEY, positions);
  }

  // ---- graph build + push ----------------------------------------------

  private async push(): Promise<void> {
    const data = this.buildData();
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

  // Translate the stored pins into the planner graph. Auto-pins are excluded (they
  // cannot carry a schedule or triggers). Event nodes are synthesized for every
  // system event that some pin triggers on, so the graph can draw the source.
  private buildData(): PlannerData {
    const pins = [
      ...this.store.getProjectPins(),
      ...this.store.getGlobalPins(),
    ].filter((p) => !p.isAuto);

    const nodes: PlannerNode[] = [];
    const edges: PlannerEdge[] = [];
    const eventsUsed = new Set<SystemEventName>();

    for (const pin of pins) {
      const result = runStatusRegistry.get(pin.id);
      const uri =
        pinKind(pin) === "file" ? this.store.resolveUri(pin) : undefined;
      nodes.push({
        id: pin.id,
        kind: "pin",
        label: pin.label ?? (pin.path.split("/").pop() ?? pin.path),
        scope: pin.scope,
        pinKind: pinKind(pin),
        description: pin.description,
        schedule: pin.schedule,
        emits: pin.emits,
        runnable:
          pinKind(pin) !== "file" || (uri ? isRunnable(pin, uri.fsPath) : false),
        lastOutcome: result?.outcome,
      });

      for (const trigger of pin.triggers ?? []) {
        if (trigger.kind === "pin") {
          edges.push({ from: trigger.pinId, to: pin.id, kind: "pin" });
        } else if (trigger.kind === "event") {
          eventsUsed.add(trigger.event);
          edges.push({
            from: `event:${trigger.event}`,
            to: pin.id,
            kind: "event",
          });
        }
        // An idle trigger has no source node (it fires from elapsed inactivity, not
        // from another pin or event), so it draws no edge in the chain graph.
      }
    }

    // Synthesize an event node for each event that is actually wired, so the edge
    // has a source to point from.
    for (const event of eventsUsed) {
      nodes.push({
        id: `event:${event}`,
        kind: "event",
        label: l10n(`chain.event.${event}`),
        event,
      });
    }

    // Drop edges whose source pin was removed (a dangling chain) so the graph never
    // draws an arrow from nothing.
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    };
  }

  // ---- shell ------------------------------------------------------------

  private renderShell(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${l10n("planner.title")}</title>
<style>${PLANNER_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph">&#x1F5D3;</div>
  <div>
    <h1>${l10n("planner.title")}</h1>
    <div class="sub">${l10n("planner.subtitle")}</div>
  </div>
  <div class="spacer"></div>
  <button id="refresh" class="btn icon" title="Refresh">&#x21BB;</button>
</div>
<div class="toolbar">
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-v="day">&#x1F551; Day</button>
    <button class="tab" role="tab" data-v="week">&#x1F4C5; Week</button>
    <button class="tab" role="tab" data-v="workflow">&#x1F517; Workflow</button>
  </div>
  <div class="spacer"></div>
  <button id="density" class="btn" title="Toggle row height (compact / comfortable)">&#x2261; Compact</button>
  <div class="legend">
    <span class="dot"><span class="sw" style="background:var(--brand)"></span>scheduled</span>
    <span class="dot"><span class="sw" style="background:var(--ok)"></span>last run ok</span>
  </div>
</div>
<div class="workarea">
  <div id="stage" class="stage"></div>
  <div id="detail" class="detail" role="complementary" aria-label="${l10n("planner.detail.label")}"></div>
</div>
<script nonce="${nonce}">${PLANNER_SCRIPT}</script>
</body>
</html>`;
  }

  private dispose(): void {
    PlannerPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

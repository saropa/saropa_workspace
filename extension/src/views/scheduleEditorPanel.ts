import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { nextOccurrence } from "../exec/schedule";
import { parseCron } from "../exec/scheduleCron";
import {
  WorkSchedule,
  workFromSchedule,
  normalizeWork,
  applyAutoEnable,
} from "../commands/scheduleModel";
import { renderScheduleEditorHtml, shortcutName } from "./scheduleEditorShell";
import { buildInsights, WireWork } from "./scheduleEditorInsights";
import { l10n } from "../i18n/l10n";

// The Schedule editor webview — a single-screen form to set ONE shortcut's schedule
// (daily time, days, repeat interval, cron, run-on-open, enabled) with every field
// visible at once, inline descriptions, and a live "next run" preview. It is the
// default "Configure Schedule..."; the keyboard-only QuickPick wizard stays reachable
// as "Configure Schedule (Quick)...". Both share the schedule model in
// commands/scheduleModel.ts, so they normalize and auto-enable identically.
//
// Local-only and safe (the native-first / webview rules): a strict CSP with a
// per-load nonce, no remote or bundled resource, themed entirely via --vscode-*
// variables. Save routes through the same store method the tree and QuickPick use, so
// it re-arms the scheduler without a reload, and reports a toast that names the
// shortcut and its next run. A second open reuses the one panel, repointed at the new
// shortcut.

// Last-used timing, remembered across shortcuts so scheduling a second shortcut starts
// from the values you just used rather than blank. Stored in globalState (machine-wide,
// like other cross-workspace preferences here).
interface ScheduleDefaults {
  atTime?: string;
  everyMs?: number;
}
const DEFAULTS_KEY = "saropaWorkspace.schedule.defaults";

// Owns the single Schedule editor webview panel: creation/reuse/repoint, the
// message protocol with the client (ready/change/save/cancel), and persisting the
// result back through the store. A singleton (`current`) so a second "Configure
// Schedule..." invocation retargets the existing panel instead of opening a duplicate.
export class ScheduleEditorPanel {
  private static current: ScheduleEditorPanel | undefined;
  private static readonly viewType = "saropaWorkspace.scheduleEditor";

  private readonly disposables: vscode.Disposable[] = [];
  // The shortcut being edited; re-read from the store on save in case it changed.
  private shortcutId: string;

  static show(context: vscode.ExtensionContext, store: ShortcutStore, shortcut: Shortcut): void {
    // Auto-shortcuts are recomputed each refresh and never stored, so a schedule
    // cannot persist on them — same guard as the QuickPick editor.
    if (shortcut.isAuto) {
      vscode.window.showWarningMessage(l10n("schedule.autoUnsupported"));
      return;
    }
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (ScheduleEditorPanel.current) {
      ScheduleEditorPanel.current.repoint(shortcut);
      ScheduleEditorPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ScheduleEditorPanel.viewType,
      l10n("scheduleEditor.title", { name: shortcutName(shortcut) }),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ScheduleEditorPanel.current = new ScheduleEditorPanel(panel, context, store, shortcut);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly store: ShortcutStore,
    shortcut: Shortcut
  ) {
    this.shortcutId = shortcut.id;
    this.panel.webview.html = renderScheduleEditorHtml(shortcut);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  // Reuse the open panel for a different shortcut: repoint, rebuild the form, retitle.
  private repoint(shortcut: Shortcut): void {
    this.shortcutId = shortcut.id;
    this.panel.title = l10n("scheduleEditor.title", { name: shortcutName(shortcut) });
    this.panel.webview.html = renderScheduleEditorHtml(shortcut);
  }

  // ---- initial working copy --------------------------------------------

  // Seed the form for a shortcut: its stored schedule, or a blank-but-enabled default
  // pre-filled with the last-used time/interval so a second shortcut starts where the
  // previous one left off (the "remember previous settings" ask).
  private initialWork(shortcut: Shortcut): WorkSchedule {
    const work = workFromSchedule(shortcut.schedule);
    if (!shortcut.schedule) {
      const defaults = this.context.globalState.get<ScheduleDefaults>(DEFAULTS_KEY);
      if (defaults?.atTime) {
        work.atTime = defaults.atTime;
      }
      if (defaults?.everyMs !== undefined) {
        work.everyMs = defaults.everyMs;
      }
    }
    return work;
  }

  // ---- message protocol -------------------------------------------------

  private async onMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) {
      return;
    }
    const msg = message as {
      type?: string;
      work?: WireWork;
      enabledTouched?: boolean;
    };
    switch (msg.type) {
      case "ready":
        await this.postInit();
        return;
      case "change":
        if (msg.work) {
          await this.postPreview(msg.work, msg.enabledTouched === true);
        }
        return;
      case "save":
        if (msg.work) {
          await this.save(msg.work, msg.enabledTouched === true);
        }
        return;
      case "cancel":
        this.panel.dispose();
        return;
    }
  }

  private async postInit(): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "init",
      work: this.initialWork(shortcut),
    });
  }

  // Compute the next-run preview and cron validity from the live form, using the
  // real scheduler math (nextOccurrence / parseCron) so the footer can never disagree
  // with what the scheduler will actually do. The same auto-enable rule the save
  // applies is computed here and echoed back as `enabled`, so the visible Enabled
  // toggle and the preview both reflect "setting a time turns it on" before save —
  // the rule lives only in applyAutoEnable (one source of truth), never in the client.
  private async postPreview(work: WireWork, enabledTouched: boolean): Promise<void> {
    const effective: WorkSchedule = { ...work };
    applyAutoEnable(effective, enabledTouched);
    const cronValid = !work.cron || parseCron(work.cron) !== undefined;
    await this.panel.webview.postMessage({
      type: "preview",
      nextRun: this.previewText(effective),
      cronValid,
      enabled: effective.enabled,
      insights: buildInsights(this.store, this.shortcutId, work),
    });
  }

  private previewText(work: WireWork): string {
    if (!work.enabled) {
      return l10n("scheduleEditor.nextRun.disabled");
    }
    // Preview as if enabled (the disabled case is handled above); normalize drops a
    // form with no timing to undefined.
    const schedule = normalizeWork({ ...work, enabled: true });
    if (!schedule) {
      return l10n("scheduleEditor.nextRun.none");
    }
    const next = nextOccurrence(schedule, Date.now());
    if (next === undefined) {
      // A startup-only schedule has no clock time but still fires on open.
      return work.runOnStartup
        ? l10n("scheduleEditor.nextRun.onOpen")
        : l10n("scheduleEditor.nextRun.none");
    }
    return new Date(next).toLocaleString();
  }

  // Persist the form: auto-enable when it has timing, normalize, write through the
  // store (which re-arms the scheduler), remember the timing as defaults, report a
  // toast that names the shortcut and its next run, and close.
  private async save(wire: WireWork, enabledTouched: boolean): Promise<void> {
    const shortcut = this.store.findShortcut(this.shortcutId);
    if (!shortcut) {
      vscode.window.showWarningMessage(l10n("scheduleEditor.gone"));
      this.panel.dispose();
      return;
    }
    const prior = shortcut.schedule;
    const work: WorkSchedule = {
      atTime: wire.atTime,
      days: wire.days,
      everyMs: wire.everyMs,
      cron: wire.cron,
      runOnStartup: wire.runOnStartup,
      catchUp: wire.catchUp,
      enabled: wire.enabled,
      // Preserve the prior fire stamp so reopen de-dup survives an edit, and the
      // durable last-result record so the Schedule screen is not blanked by a re-save.
      lastRun: prior?.lastRun,
      lastOutcome: prior?.lastOutcome,
      lastReportPath: prior?.lastReportPath,
    };
    applyAutoEnable(work, enabledTouched);

    const schedule = normalizeWork(work);
    await this.store.updateShortcutSchedule(shortcut, schedule);
    await this.rememberDefaults(work);

    const name = shortcutName(shortcut);
    if (!schedule) {
      vscode.window.showInformationMessage(l10n("scheduleEditor.cleared", { name }));
    } else if (!schedule.enabled) {
      vscode.window.showInformationMessage(
        l10n("scheduleEditor.savedDisabled", { name })
      );
    } else {
      const next = nextOccurrence(schedule, Date.now());
      const when =
        next !== undefined
          ? new Date(next).toLocaleString()
          : l10n("scheduleEditor.nextRun.onOpen");
      vscode.window.showInformationMessage(
        l10n("scheduleEditor.savedNext", { name, when })
      );
    }
    this.panel.dispose();
  }

  private async rememberDefaults(work: WorkSchedule): Promise<void> {
    // Only remember positive timing values; clearing a field should not wipe the
    // remembered default for the next shortcut.
    const defaults: ScheduleDefaults = {
      atTime: work.atTime,
      everyMs: work.everyMs,
    };
    if (defaults.atTime === undefined && defaults.everyMs === undefined) {
      return;
    }
    await this.context.globalState.update(DEFAULTS_KEY, defaults);
  }


  private dispose(): void {
    ScheduleEditorPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

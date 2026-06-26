import * as vscode from "vscode";
import * as crypto from "crypto";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { nextOccurrence, parseCron } from "../exec/schedule";
import {
  WorkSchedule,
  workFromSchedule,
  normalizeWork,
  applyAutoEnable,
} from "../commands/scheduleModel";
import {
  SCHEDULE_EDITOR_STYLE,
  SCHEDULE_EDITOR_SCRIPT,
} from "./scheduleEditorAssets";
import { l10n } from "../i18n/l10n";

// The Schedule editor webview — a single-screen form to set ONE pin's schedule
// (daily time, days, repeat interval, cron, run-on-open, enabled) with every field
// visible at once, inline descriptions, and a live "next run" preview. It is the
// default "Configure Schedule..."; the keyboard-only QuickPick wizard stays reachable
// as "Configure Schedule (Quick)...". Both share the schedule model in
// commands/scheduleModel.ts, so they normalize and auto-enable identically.
//
// Local-only and safe (the native-first / webview rules): a strict CSP with a
// per-load nonce, no remote or bundled resource, themed entirely via --vscode-*
// variables. Save routes through the same store method the tree and QuickPick use, so
// it re-arms the scheduler without a reload, and reports a toast that names the pin
// and its next run. A second open reuses the one panel, repointed at the new pin.

// Last-used timing, remembered across pins so scheduling a second pin starts from the
// values you just used rather than blank. Stored in globalState (machine-wide, like
// other cross-workspace preferences here).
interface ScheduleDefaults {
  atTime?: string;
  everyMs?: number;
}
const DEFAULTS_KEY = "saropaWorkspace.schedule.defaults";

// The wire shape the client posts back: WorkSchedule minus the host-managed lastRun.
interface WireWork {
  atTime?: string;
  days?: number[];
  everyMs?: number;
  cron?: string;
  runOnStartup?: boolean;
  enabled: boolean;
}

// One fixed-cron quick-fill offered as a chip in the form (a preset that needs no
// further prompt, unlike the QuickPick builder's time-asking presets).
interface CronChip {
  cron: string;
  labelKey: string;
}
const CRON_CHIPS: CronChip[] = [
  { cron: "0 * * * *", labelKey: "scheduleEditor.cron.chip.hourly" },
  { cron: "0 9 * * 1-5", labelKey: "scheduleEditor.cron.chip.weekday9" },
  { cron: "0 0 * * *", labelKey: "scheduleEditor.cron.chip.midnight" },
  { cron: "*/30 9-17 * * 1-5", labelKey: "scheduleEditor.cron.chip.workHours" },
];

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

export class ScheduleEditorPanel {
  private static current: ScheduleEditorPanel | undefined;
  private static readonly viewType = "saropaWorkspace.scheduleEditor";

  private readonly disposables: vscode.Disposable[] = [];
  // The pin being edited; re-read from the store on save in case it changed.
  private pinId: string;

  static show(context: vscode.ExtensionContext, store: PinStore, pin: Pin): void {
    // Auto-pins are recomputed each refresh and never stored, so a schedule cannot
    // persist on them — same guard as the QuickPick editor.
    if (pin.isAuto) {
      vscode.window.showWarningMessage(l10n("schedule.autoUnsupported"));
      return;
    }
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (ScheduleEditorPanel.current) {
      ScheduleEditorPanel.current.repoint(pin);
      ScheduleEditorPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ScheduleEditorPanel.viewType,
      l10n("scheduleEditor.title", { name: pinName(pin) }),
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ScheduleEditorPanel.current = new ScheduleEditorPanel(panel, context, store, pin);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly store: PinStore,
    pin: Pin
  ) {
    this.pinId = pin.id;
    this.panel.webview.html = this.renderShell(pin);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      null,
      this.disposables
    );
  }

  // Reuse the open panel for a different pin: repoint, rebuild the form, retitle.
  private repoint(pin: Pin): void {
    this.pinId = pin.id;
    this.panel.title = l10n("scheduleEditor.title", { name: pinName(pin) });
    this.panel.webview.html = this.renderShell(pin);
  }

  // ---- initial working copy --------------------------------------------

  // Seed the form for a pin: its stored schedule, or a blank-but-enabled default
  // pre-filled with the last-used time/interval so a second pin starts where the
  // previous one left off (the "remember previous settings" ask).
  private initialWork(pin: Pin): WorkSchedule {
    const work = workFromSchedule(pin.schedule);
    if (!pin.schedule) {
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
          await this.postPreview(msg.work);
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
    const pin = this.store.findPin(this.pinId);
    if (!pin) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "init",
      work: this.initialWork(pin),
    });
  }

  // Compute the next-run preview and cron validity from the live form, using the
  // real scheduler math (nextOccurrence / parseCron) so the footer can never disagree
  // with what the scheduler will actually do.
  private async postPreview(work: WireWork): Promise<void> {
    const cronValid = !work.cron || parseCron(work.cron) !== undefined;
    await this.panel.webview.postMessage({
      type: "preview",
      nextRun: this.previewText(work),
      cronValid,
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
  // toast that names the pin and its next run, and close.
  private async save(wire: WireWork, enabledTouched: boolean): Promise<void> {
    const pin = this.store.findPin(this.pinId);
    if (!pin) {
      vscode.window.showWarningMessage(l10n("scheduleEditor.gone"));
      this.panel.dispose();
      return;
    }
    const prior = pin.schedule;
    const work: WorkSchedule = {
      atTime: wire.atTime,
      days: wire.days,
      everyMs: wire.everyMs,
      cron: wire.cron,
      runOnStartup: wire.runOnStartup,
      enabled: wire.enabled,
      // Preserve the prior fire stamp so reopen de-dup survives an edit.
      lastRun: prior?.lastRun,
    };
    applyAutoEnable(work, enabledTouched);

    const schedule = normalizeWork(work);
    await this.store.updatePinSchedule(pin, schedule);
    await this.rememberDefaults(work);

    const name = pinName(pin);
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
    // remembered default for the next pin.
    const defaults: ScheduleDefaults = {
      atTime: work.atTime,
      everyMs: work.everyMs,
    };
    if (defaults.atTime === undefined && defaults.everyMs === undefined) {
      return;
    }
    await this.context.globalState.update(DEFAULTS_KEY, defaults);
  }

  // ---- shell ------------------------------------------------------------

  private renderShell(pin: Pin): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const title = l10n("scheduleEditor.title", { name: pinName(pin) });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${SCHEDULE_EDITOR_STYLE}</style>
</head>
<body>
<div class="hero">
  <div class="glyph">&#x1F551;</div>
  <div class="htext">
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(l10n("scheduleEditor.subtitle", { name: pinName(pin) }))}</div>
  </div>
</div>

${this.dailyCard()}
${this.repeatCard()}
${this.cronCard()}
${this.optionsCard()}

<div class="footer">
  <div class="nr">
    <span class="nl">${esc(l10n("scheduleEditor.nextRun"))}</span>
    <span class="nv" id="nextRun"></span>
  </div>
  <div class="spacer"></div>
  <button class="btn" id="cancel">${esc(l10n("scheduleEditor.cancel"))}</button>
  <button class="btn primary" id="save">${esc(l10n("scheduleEditor.save"))}</button>
</div>

<script nonce="${nonce}">${SCHEDULE_EDITOR_SCRIPT}</script>
</body>
</html>`;
  }

  private dailyCard(): string {
    const chips = [0, 1, 2, 3, 4, 5, 6]
      .map(
        (d) =>
          `<button class="chip" type="button" data-day="${d}">${esc(
            l10n(`scheduleEditor.weekday.${d}`)
          )}</button>`
      )
      .join("");
    return `<div class="card">
  <div class="ttl">${esc(l10n("scheduleEditor.section.daily"))}</div>
  <div class="desc">${esc(l10n("scheduleEditor.daily.desc"))}</div>
  <div class="row">
    <input type="time" id="atTime" />
    <button class="btn link" id="clearTime" type="button">${esc(l10n("scheduleEditor.daily.clear"))}</button>
  </div>
  <div class="desc" style="margin-top:12px">${esc(l10n("scheduleEditor.section.days"))}</div>
  <div class="row" style="margin-bottom:8px">
    <button class="btn" id="setWeekdays" type="button">${esc(l10n("scheduleEditor.days.weekdays"))}</button>
    <button class="btn" id="setWeekends" type="button">${esc(l10n("scheduleEditor.days.weekends"))}</button>
    <button class="btn" id="setEveryDay" type="button">${esc(l10n("scheduleEditor.days.every"))}</button>
  </div>
  <div class="days" id="days">${chips}</div>
  <div class="hint" id="daysHint">${esc(l10n("scheduleEditor.days.needsTime"))}</div>
</div>`;
  }

  private repeatCard(): string {
    const options: Array<{ value: string; label: string }> = [
      { value: "none", label: l10n("scheduleEditor.repeat.none") },
      { value: String(5 * MIN_MS), label: l10n("schedule.interval.everyMinutes", { count: 5 }) },
      { value: String(15 * MIN_MS), label: l10n("schedule.interval.everyMinutes", { count: 15 }) },
      { value: String(30 * MIN_MS), label: l10n("schedule.interval.everyMinutes", { count: 30 }) },
      { value: String(HOUR_MS), label: l10n("schedule.interval.everyHours", { count: 1 }) },
      { value: String(6 * HOUR_MS), label: l10n("schedule.interval.everyHours", { count: 6 }) },
      { value: String(12 * HOUR_MS), label: l10n("schedule.interval.everyHours", { count: 12 }) },
      { value: String(DAY_MS), label: l10n("schedule.interval.everyDays", { count: 1 }) },
      { value: "custom", label: l10n("scheduleEditor.repeat.custom") },
    ];
    const opts = options
      .map((o) => `<option value="${o.value}">${esc(o.label)}</option>`)
      .join("");
    const units: Array<{ value: string; label: string }> = [
      { value: String(MIN_MS), label: l10n("schedule.unit.minutes") },
      { value: String(HOUR_MS), label: l10n("schedule.unit.hours") },
      { value: String(DAY_MS), label: l10n("schedule.unit.days") },
    ];
    const unitOpts = units
      .map((u) => `<option value="${u.value}">${esc(u.label)}</option>`)
      .join("");
    return `<div class="card">
  <div class="ttl">${esc(l10n("scheduleEditor.section.repeat"))}</div>
  <div class="desc">${esc(l10n("scheduleEditor.repeat.desc"))}</div>
  <div class="row">
    <select id="interval">${opts}</select>
    <span class="row" id="customWrap" style="display:none">
      <input type="number" id="customCount" min="1" value="1" style="width:80px" />
      <select id="customUnit">${unitOpts}</select>
    </span>
  </div>
</div>`;
  }

  private cronCard(): string {
    const chips = CRON_CHIPS.map(
      (c) =>
        `<button class="btn cronchip" type="button" data-cron="${esc(c.cron)}">${esc(
          l10n(c.labelKey)
        )}</button>`
    ).join("");
    return `<div class="card">
  <div class="ttl">${esc(l10n("scheduleEditor.section.cron"))}</div>
  <div class="desc">${esc(l10n("scheduleEditor.cron.desc"))}</div>
  <div class="row" style="margin-bottom:8px">${chips}</div>
  <input type="text" class="cron" id="cron" placeholder="${esc(l10n("schedule.cron.advancedPlaceholder"))}" />
  <span class="invalid" id="cronInvalid">${esc(l10n("scheduleEditor.cron.invalid"))}</span>
</div>`;
  }

  private optionsCard(): string {
    return `<div class="card">
  <div class="ttl">${esc(l10n("scheduleEditor.section.options"))}</div>
  <div class="opt">
    <div class="meta">
      <div class="lab">${esc(l10n("scheduleEditor.runOnStartup"))}</div>
      <div class="d">${esc(l10n("scheduleEditor.runOnStartup.desc"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="runOnStartup" /><span class="track"></span><span class="knob"></span></label>
  </div>
  <div class="opt">
    <div class="meta">
      <div class="lab">${esc(l10n("scheduleEditor.enabled"))}</div>
      <div class="d">${esc(l10n("scheduleEditor.enabled.desc"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="enabled" /><span class="track"></span><span class="knob"></span></label>
  </div>
</div>`;
  }

  private dispose(): void {
    ScheduleEditorPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// The display name for a pin, falling back to its file basename.
function pinName(pin: Pin): string {
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// Escape text destined for an HTML text node or a double-quoted attribute, so a pin
// label or cron string can never inject markup into the webview.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

import * as vscode from "vscode";
import * as crypto from "crypto";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { nextOccurrence, parseCron, parseHourMinute } from "../exec/schedule";
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
const MINUTES_PER_DAY = 24 * 60;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// Cap on how many clashing shortcut names to spell out before collapsing to "+N more",
// so a busy time slot does not produce an unreadable wall of names.
const MAX_NAMED = 3;

// One other scheduled shortcut placed on the 24-hour strip: its name and its daily
// time as minutes-of-day. Sent to the client as {n, m} (terse keys keep the payload
// small).
interface Neighbor {
  name: string;
  minutes: number;
  days: number[];
}

// What the "Around your schedule" card renders: this shortcut's daily time (minutes,
// or null when it has none), the other daily-scheduled shortcuts as ticks, a
// same-minute conflict warning, a free-gap note, and the gap's bounds for the visual
// band. The two prose lines are localized host-side so the client carries no display
// strings.
interface Insights {
  mine: number | null;
  neighbors: Array<{ n: string; m: number }>;
  conflict: string;
  note: string;
  gapFrom: number | null;
  gapTo: number | null;
}

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
    this.panel.webview.html = this.renderShell(shortcut);
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
    this.panel.webview.html = this.renderShell(shortcut);
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
      insights: this.buildInsights(work),
    });
  }

  // Place this shortcut's daily time against every other enabled, daily-scheduled
  // shortcut: a 24-hour strip of neighbor ticks, a same-minute conflict warning (two
  // shortcuts firing in the same minute contend for CPU), and the largest free gap in
  // the day. Cron and interval shortcuts have no single clock time, so they are not
  // plotted here; this view is about the daily-time landscape, which is what "conflicts
  // and gaps" most concerns.
  private buildInsights(work: WireWork): Insights {
    const mineParsed = work.atTime ? parseHourMinute(work.atTime) : undefined;
    const mine = mineParsed ? mineParsed.hour * 60 + mineParsed.minute : null;
    const mineDays =
      work.days && work.days.length > 0 ? work.days : ALL_DAYS;

    const neighbors: Neighbor[] = [];
    for (const shortcut of [
      ...this.store.getProjectShortcuts(),
      ...this.store.getGlobalShortcuts(),
    ]) {
      const schedule = shortcut.schedule;
      if (shortcut.id === this.shortcutId || !schedule?.enabled || !schedule.atTime) {
        continue;
      }
      const parsed = parseHourMinute(schedule.atTime);
      if (!parsed) {
        continue;
      }
      neighbors.push({
        name: shortcutName(shortcut),
        minutes: parsed.hour * 60 + parsed.minute,
        days:
          schedule.days && schedule.days.length > 0 ? schedule.days : ALL_DAYS,
      });
    }

    return {
      mine,
      neighbors: neighbors.map((nb) => ({ n: nb.name, m: nb.minutes })),
      conflict: this.conflictText(mine, mineDays, neighbors),
      ...this.gapInfo(mine, neighbors),
    };
  }

  // Names of other shortcuts firing in the SAME minute on an overlapping weekday, as a
  // localized warning — or '' when nothing clashes.
  private conflictText(
    mine: number | null,
    mineDays: number[],
    neighbors: Neighbor[]
  ): string {
    if (mine === null) {
      return "";
    }
    const clashing = neighbors
      .filter((nb) => nb.minutes === mine && daysOverlap(nb.days, mineDays))
      .map((nb) => nb.name);
    if (clashing.length === 0) {
      return "";
    }
    return l10n("scheduleEditor.insight.conflict", {
      time: formatMinutes(mine),
      names: formatNames(clashing),
    });
  }

  // The largest stretch of the day with no daily run, as a localized note plus the
  // gap's bounds for the visual band. Needs at least two distinct times to be
  // meaningful; with only this shortcut (no daily neighbors) it reports "nothing else",
  // and with no daily time at all it prompts to add one.
  private gapInfo(
    mine: number | null,
    neighbors: Neighbor[]
  ): { note: string; gapFrom: number | null; gapTo: number | null } {
    if (mine === null && neighbors.length === 0) {
      return { note: l10n("scheduleEditor.insight.empty"), gapFrom: null, gapTo: null };
    }
    if (mine !== null && neighbors.length === 0) {
      return { note: l10n("scheduleEditor.insight.alone"), gapFrom: null, gapTo: null };
    }
    const times = neighbors.map((nb) => nb.minutes);
    if (mine !== null) {
      times.push(mine);
    }
    const unique = [...new Set(times)].sort((a, b) => a - b);
    if (unique.length < 2) {
      return { note: "", gapFrom: null, gapTo: null };
    }
    // Walk consecutive times on a 24h ring; the largest span between two adjacent
    // runs is the free gap. The last-to-first wrap crosses midnight (+1440).
    let bestSpan = -1;
    let from = 0;
    let to = 0;
    for (let i = 0; i < unique.length; i++) {
      const start = unique[i] ?? 0;
      const end = i + 1 < unique.length ? unique[i + 1] ?? 0 : (unique[0] ?? 0) + MINUTES_PER_DAY;
      const span = end - start;
      if (span > bestSpan) {
        bestSpan = span;
        from = start;
        to = end % MINUTES_PER_DAY;
      }
    }
    return {
      note: l10n("scheduleEditor.insight.gap", {
        from: formatMinutes(from),
        to: formatMinutes(to),
        span: formatSpan(bestSpan),
      }),
      gapFrom: from,
      gapTo: to,
    };
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
      enabled: wire.enabled,
      // Preserve the prior fire stamp so reopen de-dup survives an edit.
      lastRun: prior?.lastRun,
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

  // ---- shell ------------------------------------------------------------

  private renderShell(shortcut: Shortcut): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      "img-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    const title = l10n("scheduleEditor.title", { name: shortcutName(shortcut) });

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
    <div class="sub">${esc(l10n("scheduleEditor.subtitle", { name: shortcutName(shortcut) }))}</div>
  </div>
</div>

${this.dailyCard()}
${this.repeatCard()}
${this.cronCard()}
${this.optionsCard()}
${this.aroundCard()}

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

  // "Around your schedule": a 24-hour strip showing how this shortcut's daily time sits
  // against the other scheduled shortcuts, a same-minute conflict warning, and the
  // largest free gap. The track contents (ticks, this shortcut's marker, the gap band)
  // are drawn by the client from the host's insights payload; the hour rail and the
  // prose rows are host-rendered. Hour labels are 24-hour numerals (locale-neutral), so
  // they need no catalog key.
  private aroundCard(): string {
    const hours = [0, 6, 12, 18, 24]
      .map(
        (h) =>
          `<span class="tl-h" style="left:${(h / 24) * 100}%">${String(h).padStart(2, "0")}</span>`
      )
      .join("");
    return `<div class="card">
  <div class="ttl">${esc(l10n("scheduleEditor.section.around"))}</div>
  <div class="desc">${esc(l10n("scheduleEditor.around.desc"))}</div>
  <div class="tl">
    <div class="tl-track" id="tlTrack">
      <div class="tl-grid"></div>
    </div>
    <div class="tl-hours">${hours}</div>
  </div>
  <div class="insight warn" id="insConflict"></div>
  <div class="insight" id="insNote"></div>
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

// The display name for a shortcut, falling back to its file basename.
function shortcutName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

// Whether two weekday sets share any day (an empty set already means "every day" by
// the time it reaches here, so both are concrete 0..6 lists).
function daysOverlap(a: number[], b: number[]): boolean {
  const set = new Set(a);
  return b.some((d) => set.has(d));
}

// Join clashing shortcut names for the conflict warning, collapsing a long list to the
// first few plus a localized "+N more" so a busy slot stays readable.
function formatNames(names: string[]): string {
  if (names.length <= MAX_NAMED) {
    return names.join(", ");
  }
  return l10n("scheduleEditor.insight.andMore", {
    names: names.slice(0, MAX_NAMED).join(", "),
    count: names.length - MAX_NAMED,
  });
}

// Minutes-of-day to a zero-padded local "HH:mm".
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// A minute span as a compact "Xh Ym" / "Xh" / "Ym" duration shorthand (numeric, not
// prose — the surrounding sentence is the localized part).
function formatSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) {
    return `${m}m`;
  }
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Escape text destined for an HTML text node or a double-quoted attribute, so a
// shortcut label or cron string can never inject markup into the webview.
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

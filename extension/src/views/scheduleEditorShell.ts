// The static HTML for the Schedule editor webview: the CSP shell and the five form cards
// (daily time + days, repeat interval, cron, options, the "Around your schedule" strip).
// Split out of scheduleEditorPanel.ts so the panel file stays the host/protocol side and
// this stays the markup. Every card builder is a pure string function (no `this`), so the
// panel just calls renderScheduleEditorHtml(shortcut).
//
// Local-only and safe (the native-first / webview rules): a strict CSP with a per-load
// nonce, no remote or bundled resource, themed entirely via --vscode-* variables. All
// visible text is externalized through l10n; nothing here trusts a label as markup (see
// esc).
import * as crypto from "crypto";
import { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import { SCHEDULE_EDITOR_STYLE, SCHEDULE_EDITOR_SCRIPT } from "./scheduleEditorAssets";

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

// One fixed-cron quick-fill offered as a chip in the form (a preset that needs no further
// prompt, unlike the QuickPick builder's time-asking presets).
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

// The display name for a shortcut, falling back to its file basename. Shared with the
// panel (titles, toasts) and the insights math (neighbor names) so all three agree.
export function shortcutName(shortcut: Shortcut): string {
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

export function renderScheduleEditorHtml(shortcut: Shortcut): string {
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

${dailyCard()}
${repeatCard()}
${cronCard()}
${optionsCard()}
${aroundCard()}

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

function dailyCard(): string {
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

function repeatCard(): string {
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

function cronCard(): string {
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

function optionsCard(): string {
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
      <div class="lab">${esc(l10n("scheduleEditor.catchUp"))}</div>
      <div class="d">${esc(l10n("scheduleEditor.catchUp.desc"))}</div>
    </div>
    <div class="spacer"></div>
    <label class="switch"><input type="checkbox" id="catchUp" /><span class="track"></span><span class="knob"></span></label>
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
// against the other scheduled shortcuts, a same-minute conflict warning, and the largest
// free gap. The track contents (ticks, this shortcut's marker, the gap band) are drawn by
// the client from the host's insights payload; the hour rail and the prose rows are
// host-rendered. Hour labels are 24-hour numerals (locale-neutral), so they need no
// catalog key.
function aroundCard(): string {
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

// Escape text destined for an HTML text node or a double-quoted attribute, so a shortcut
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

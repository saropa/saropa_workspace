import * as crypto from "crypto";
import { PLANNER_STYLE, PLANNER_SCRIPT } from "./plannerAssets";
import { l10n } from "../i18n/l10n";

// Builds the planner webview's static HTML shell (hero band, tab toolbar, stage +
// detail panes) under a strict CSP with a per-load nonce. Pure string builder — no
// panel state — so PlannerPanel just assigns the result to `webview.html`.
export function renderShell(): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  // The client script (a plain concatenated <script>, not a module) reads its display
  // strings off this STRINGS global rather than hardcoding English, matching the
  // dashboard webview's l10n bridge — see dashboardShell.ts's uiStrings(). Injected as
  // a JSON literal ahead of the script body so it is in scope before any fragment runs.
  const strings = JSON.stringify(uiStrings());
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
  <button id="refresh" class="btn icon" title="${l10n("schedulePanel.refresh")}">&#x21BB;</button>
</div>
<div class="toolbar">
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-v="day">&#x1F551; ${l10n("planner.tab.day")}</button>
    <button class="tab" role="tab" data-v="week">&#x1F4C5; ${l10n("planner.tab.week")}</button>
    <button class="tab" role="tab" data-v="workflow">&#x1F517; ${l10n("planner.tab.workflow")}</button>
  </div>
  <div class="spacer"></div>
  <button id="density" class="btn" title="${l10n("planner.density.toggleTitle")}">&#x2261; ${l10n("planner.density.compact")}</button>
  <div class="legend">
    <span class="dot"><span class="sw" style="background:var(--brand)"></span>${l10n("planner.legend.scheduled")}</span>
    <span class="dot"><span class="sw" style="background:var(--ok)"></span>${l10n("planner.legend.lastRunOk")}</span>
  </div>
</div>
<div class="workarea">
  <div id="stage" class="stage"></div>
  <div id="detail" class="detail" role="complementary" aria-label="${l10n("planner.detail.label")}">
    <div id="rsz-detail" class="rsz" role="separator" aria-orientation="vertical" title="${l10n("planner.detail.resize")}"></div>
    <div id="detail-body" class="detail-body"></div>
  </div>
</div>
<script nonce="${nonce}">const STRINGS = ${strings};
${PLANNER_SCRIPT}</script>
</body>
</html>`;
}

// The localized strings the client script renders. Kept out of the inlined JS so the
// planner stays translation-ready (en.json is the single source); values reuse an
// existing catalog key wherever another surface already carries the exact same word
// (e.g. "Open", "Run now") rather than restating the literal under a new planner.* key.
function uiStrings(): Record<string, string | string[]> {
  return {
    // Weekday abbreviations: reused verbatim from the schedule editor catalog rather
    // than duplicated here, so there is one source for "Mon"/"Tue"/etc.
    weekdayShort: [0, 1, 2, 3, 4, 5, 6].map((d) => l10n(`scheduleEditor.weekday.${d}`)),
    now: l10n("planner.now"),
    everyMinutes: l10n("planner.every.minutes"),
    everyHours: l10n("planner.every.hours"),
    everyDays: l10n("planner.every.days"),
    densityCompact: l10n("planner.density.compact"),
    densityComfortable: l10n("planner.density.comfortable"),
    dayHeading: l10n("planner.day.heading"),
    dayEmptyTitle: l10n("planner.day.emptyTitle"),
    dayEmptyDetail: l10n("planner.day.emptyDetail"),
    dayIntervalsHeading: l10n("planner.day.intervalsHeading"),
    daysEveryDay: l10n("planner.days.everyDay"),
    daysWeekdays: l10n("planner.days.weekdays"),
    daysWeekends: l10n("planner.days.weekends"),
    weekBlockHint: l10n("planner.week.blockHint"),
    weekEmptyTitle: l10n("planner.week.emptyTitle"),
    weekEmptyDetail: l10n("planner.week.emptyDetail"),
    detailDailyAt: l10n("planner.detail.dailyAt"),
    detailPaused: l10n("planner.detail.paused"),
    detailRepeats: l10n("planner.detail.repeats"),
    detailAfter: l10n("planner.detail.after"),
    detailRuns: l10n("planner.detail.runs"),
    detailEmits: l10n("planner.detail.emits"),
    detailNone: l10n("planner.detail.none"),
    detailClose: l10n("planner.detail.close"),
    open: l10n("launcher.open"),
    runNow: l10n("schedulePanel.runNow"),
    schedule: l10n("launcher.menu.schedule"),
    pause: l10n("launcher.menu.pause"),
    resume: l10n("launcher.menu.resume"),
    triggers: l10n("planner.action.triggers"),
    markEmits: l10n("planner.action.markEmits"),
    pauseSchedule: l10n("planner.action.pauseSchedule"),
    resumeSchedule: l10n("planner.action.resumeSchedule"),
    addLinkFromHere: l10n("planner.action.addLinkFromHere"),
    removeTriggerHeading: l10n("planner.action.removeTriggerHeading"),
    linkPlaceholderTarget: l10n("planner.link.placeholderTarget"),
    linkPlaceholderSearch: l10n("planner.link.placeholderSearch"),
    linkNoMatch: l10n("planner.link.noMatch"),
    toolboxTitle: l10n("planner.workflow.toolboxTitle"),
    eventBuild: l10n("planner.event.build"),
    eventPublish: l10n("planner.event.publish"),
    eventGitCommit: l10n("planner.event.gitCommit"),
    eventGitPush: l10n("planner.event.gitPush"),
    toolboxHint: l10n("planner.workflow.toolboxHint"),
    toolboxResizeTitle: l10n("planner.workflow.toolboxResizeTitle"),
    howtoStep1: l10n("planner.howto.step1"),
    howtoStep2: l10n("planner.howto.step2"),
    howtoStep3: l10n("planner.howto.step3"),
    howtoAddLinkTitle: l10n("planner.howto.addLinkTitle"),
    howtoAddLink: l10n("planner.howto.addLink"),
    howtoAutoArrangeTitle: l10n("planner.howto.autoArrangeTitle"),
    howtoAutoArrange: l10n("planner.howto.autoArrange"),
    dropEventHint: l10n("planner.workflow.dropEventHint"),
    dropShortcutHint: l10n("planner.workflow.dropShortcutHint"),
    workflowEmptyTitle: l10n("planner.workflow.emptyTitle"),
    workflowEmptyDetail: l10n("planner.workflow.emptyDetail"),
    plugTitle: l10n("planner.workflow.plugTitle"),
    eventBadge: l10n("planner.workflow.eventBadge"),
    shelfTitle: l10n("planner.shelf.title"),
    shelfHint: l10n("planner.shelf.hint"),
    shelfNoMatch: l10n("planner.shelf.noMatch"),
    shelfAllWired: l10n("planner.shelf.allWired"),
    shelfFilterPlaceholder: l10n("planner.shelf.filterPlaceholder"),
  };
}

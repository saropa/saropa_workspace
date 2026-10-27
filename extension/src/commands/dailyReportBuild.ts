// Daily report text: the executive summary, trouble list, workspace activity and
// per-tool sections assembled into one Markdown document. Pure given its inputs.
// Split out of dailyReport.ts, which re-exports buildDailyReport.

import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutDisplayName } from "../model/shortcutDisplayName";
import { telemetry, RunRecord } from "../exec/telemetry";
import { runStatusRegistry, formatDuration } from "../exec/runStatus";

import { l10n } from "../i18n/l10n";
import type { ToolSection, SuiteDailySummary } from "./dailyReport";

// Exported for unit tests: pure over the telemetry store, the session registry,
// and the pre-fetched tool sections, so every branch is assertable without the
// extension host or live siblings.
export function buildDailyReport(
  store: ShortcutStore,
  today: string,
  tools: ToolSection[],
  mismatched: string[] = []
): string {
  const lines: string[] = [
    `# ${l10n("dailyReport.title", { date: today })}`,
    "",
    `> ${l10n("dailyReport.intro")}`,
    "",
  ];

  lines.push(...executiveSection(tools));

  // An installed tool whose exported apiVersion this consumer does not understand
  // is NAMED, right under the executive summary — the alternative (an omitted
  // section) reads as "no data today" when the truth is a version skew between
  // Suite extensions.
  for (const tool of mismatched) {
    lines.push(`_${l10n("dailyReport.versionMismatch", { tool })}_`, "");
  }
  lines.push(...troubleSection(store, tools));
  lines.push(...workspaceSection(store));
  for (const tool of tools) {
    lines.push(...toolSection(tool));
  }

  // Every sibling absent (solo install / none activated with data): say so once,
  // so a workspace-only report reads as intentional rather than broken.
  if (tools.length === 0) {
    lines.push(`_${l10n("dailyReport.noSiblings")}_`, "");
  }

  return lines.join("\n");
}

// The read-this-first block: each tool's own one-sentence headline for today,
// plus Workspace's run sentence. Yesterday's headlines are deliberately not
// repeated here — they appear in the per-tool sections — so the summary stays a
// glance, not a scroll.
function executiveSection(tools: ToolSection[]): string[] {
  const out = [`## ${l10n("dailyReport.executiveHeading")}`, ""];
  const runs = runStatusRegistry.entries();
  const failed = runs.filter(([, r]) => r.outcome !== "success").length;
  out.push(
    `- **Saropa Workspace** — ${l10n("dailyReport.workspaceHeadline", {
      runs: runs.length,
      failed,
    })}`
  );
  for (const tool of tools) {
    if (tool.today) {
      out.push(`- **${tool.name}** — ${tool.today.headline}`);
    }
  }
  out.push("");
  return out;
}

// Failure-only view (Trouble Mode's hide-the-nominal principle): Workspace's
// failed session runs plus every sibling trouble item from both days. An empty
// Trouble section states so in one line — silence would read as an omission.
function troubleSection(store: ShortcutStore, tools: ToolSection[]): string[] {
  const out = [`## ${l10n("dailyReport.troubleHeading")}`, ""];
  const items: string[] = [];

  const failedRuns = runStatusRegistry
    .entries()
    .filter(([, result]) => result.outcome !== "success");
  for (const [pinId, result] of failedRuns) {
    items.push(
      `- **${nameFor(store, pinId)}** — ${l10n("dailyReport.runFailed", {
        code: result.exitCode ?? "—",
        duration: formatDuration(result.durationMs),
      })}`
    );
  }

  for (const tool of tools) {
    for (const summary of [tool.today, tool.yesterday]) {
      for (const item of summary?.trouble ?? []) {
        const detail = item.detail ? ` — ${item.detail}` : "";
        items.push(`- **${tool.name}**: ${item.label}${detail}`);
      }
    }
  }

  if (items.length === 0) {
    out.push(`_${l10n("dailyReport.troubleEmpty")}_`, "");
    return out;
  }
  out.push(...items, "");
  return out;
}

// Workspace's own activity: today's recorded runs/opens from local telemetry.
// Telemetry off degrades ONLY this section (standard "turn it on" note) — the
// sibling sections come from their own stores and still render.
function workspaceSection(store: ShortcutStore): string[] {
  const out = [`## ${l10n("dailyReport.workspaceHeading")}`, ""];
  if (!telemetry.enabled()) {
    out.push(`_${l10n("dailyReport.workspaceDisabled")}_`, "");
    return out;
  }
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todays = telemetry.recent().filter((r) => r.at >= startOfDay.getTime());
  if (todays.length === 0) {
    out.push(`_${l10n("dailyReport.workspaceNone")}_`, "");
    return out;
  }
  for (const record of todays) {
    out.push(`- **${nameFor(store, record.pinId)}** — ${activityLabel(record)}`);
  }
  out.push("");
  return out;
}

// One activity line: what happened (run vs open) and when (wall-clock time, not
// relative — a daily report is re-read later, when "5 minutes ago" would lie).
function activityLabel(record: RunRecord): string {
  const at = new Date(record.at);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(
    at.getMinutes()
  ).padStart(2, "0")}`;
  // Pre-tracking records carry no kind and are read as runs, matching telemetry's
  // own back-compat convention.
  const key =
    record.kind === "opened" ? "dailyReport.openedAt" : "dailyReport.ranAt";
  return l10n(key, { time });
}

// One sibling's block: today then yesterday, each as the tool's headline plus its
// counts on one scannable line. A day with no data is skipped, not zero-filled.
function toolSection(tool: ToolSection): string[] {
  const out = [`## ${tool.name}`, ""];
  const days: Array<[string, SuiteDailySummary | undefined]> = [
    [l10n("dailyReport.today"), tool.today],
    [l10n("dailyReport.yesterday"), tool.yesterday],
  ];
  for (const [label, summary] of days) {
    if (!summary) {
      continue;
    }
    out.push(`**${label}** — ${summary.headline}`);
    const counts = Object.entries(summary.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    if (counts.length > 0) {
      out.push("", `\`${counts}\``);
    }
    out.push("");
  }
  return out;
}

// Resolve a recorded shortcut id to a display name; a run can outlive its
// shortcut, so fall back to the removed-shortcut marker rather than the raw id.
function nameFor(store: ShortcutStore, pinId: string): string {
  const shortcut: Shortcut | undefined = store.findShortcut(pinId);
  if (!shortcut) {
    return l10n("analytics.unknownPin");
  }
  return shortcutDisplayName(shortcut);
}

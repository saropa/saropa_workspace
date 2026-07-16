import * as vscode from "vscode";
import { Shortcut } from "../model/shortcut";
import { ShortcutStore } from "../model/shortcutStore";
import { telemetry, RunRecord } from "../exec/telemetry";
import { runStatusRegistry, RunResult, formatDuration } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";

// Saropa Suite Daily Report — the conductor's consolidated view of the day.
// Merges Workspace's own local run activity with one-day summaries pulled from the
// other Saropa Suite extensions through their public `getDailySummary` exports API
// (the data-out half of the cross-tool contract; the deep-link command ids are the
// jump-in half). Everything is read on-machine: Workspace telemetry from
// globalState, sibling data from an in-process API call — nothing is transmitted.
//
// Rendered as a read-only Markdown preview via a virtual document, mirroring Run
// Analytics, so there is no temp file and nothing to edit or save by accident.

// The Suite siblings polled for a daily summary. Marketplace extension ids are
// stable identifiers (never renamed once published), so hardcoding them here is
// the contract, not a fragile guess. A tool that is not installed, not yet
// activated, or predates the summary API simply contributes no section.
const SUITE_TOOLS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "saropa.saropa-log-capture", name: "Saropa Log Capture" },
  { id: "saropa.saropa-lints", name: "Saropa Lints" },
  { id: "saropa.drift-viewer", name: "Saropa Drift Advisor" },
];

// Structural copy of the shape each sibling returns from getDailySummary().
// Deliberately NOT imported from the siblings: a type import would couple this
// build to their repos. The shape is validated at runtime (isDailySummary) because
// the payload crosses an extension boundary — treat it like parsed JSON.
interface SuiteDailySummary {
  readonly tool: string;
  readonly date: string;
  readonly headline: string;
  readonly counts: Record<string, number>;
  readonly trouble: ReadonlyArray<{
    readonly label: string;
    readonly detail?: string;
  }>;
}

// The versioned API surface a Suite tool exports from activate(). Only the members
// this report reads are declared; siblings may export more.
interface SuiteApi {
  readonly apiVersion?: number;
  getDailySummary?(date: string): Promise<SuiteDailySummary | undefined>;
}

// One sibling's contribution to the report: its display name plus the day
// summaries it returned (either day may be absent when the tool has no data).
interface ToolSection {
  readonly name: string;
  readonly today?: SuiteDailySummary;
  readonly yesterday?: SuiteDailySummary;
}

class DailyReportPreviewProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "saropa-daily-report";

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  // Single virtual document keyed by a fixed path, so re-running the command
  // refreshes the open preview instead of stacking tabs.
  private body = "";

  provideTextDocumentContent(): string {
    return this.body;
  }

  async show(content: string): Promise<void> {
    this.body = content;
    const uri = vscode.Uri.from({
      scheme: DailyReportPreviewProvider.scheme,
      path: "/daily-report.md",
    });
    this._onDidChange.fire(uri);
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

const preview = new DailyReportPreviewProvider();

// Register the virtual-document provider that backs the report preview. Pushed to
// subscriptions so the provider and its emitter are disposed on deactivation.
export function registerDailyReport(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DailyReportPreviewProvider.scheme,
      preview
    ),
    preview
  );
}

// Entry point for the "Daily Report" command: poll the installed siblings for
// today's and yesterday's summaries, then render everything as one document.
export async function showDailyReport(store: ShortcutStore): Promise<void> {
  const now = new Date();
  const today = isoDay(now);
  const yesterday = isoDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const sections = await collectToolSections(today, yesterday);
  await preview.show(buildDailyReport(store, today, sections));
}

// Local calendar date as YYYY-MM-DD. Built from local components (not
// toISOString, which is UTC) because "today" in a daily report means the
// developer's wall-clock day.
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Ask every installed Suite tool for both days. Tools are polled concurrently —
// each call is independent and a slow sibling must not serialize the report.
async function collectToolSections(
  today: string,
  yesterday: string
): Promise<ToolSection[]> {
  const results = await Promise.all(
    SUITE_TOOLS.map(async (tool): Promise<ToolSection | undefined> => {
      const api = await resolveSuiteApi(tool.id);
      if (!api?.getDailySummary) {
        return undefined;
      }
      const [todaySummary, yesterdaySummary] = await Promise.all([
        safeSummary(api, today),
        safeSummary(api, yesterday),
      ]);
      if (!todaySummary && !yesterdaySummary) {
        return undefined;
      }
      return {
        name: tool.name,
        today: todaySummary,
        yesterday: yesterdaySummary,
      };
    })
  );
  return results.filter((s): s is ToolSection => s !== undefined);
}

// Ceiling on any single sibling operation (activation or a summary call). A
// sibling that hangs — a stuck activation, an API that never resolves — must not
// hang the whole report command; past the ceiling the tool's section is simply
// omitted, the same degradation as an absent tool.
const SIBLING_TIMEOUT_MS = 5000;

// Race a sibling promise against the ceiling. Resolves undefined on timeout —
// never rejects, so callers keep their absent-tool fallback path.
function withSiblingTimeout<T>(work: Promise<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), SIBLING_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

// Resolve a sibling's exports, activating it on demand. Activation is required:
// an installed-but-idle extension has no exports yet, and a daily report that
// silently skipped idle tools would under-report the Suite. Failures (not
// installed, activation error, activation hang past the ceiling) yield undefined —
// the section is omitted, never an error surface.
async function resolveSuiteApi(id: string): Promise<SuiteApi | undefined> {
  const ext = vscode.extensions.getExtension<SuiteApi>(id);
  if (!ext) {
    return undefined;
  }
  try {
    const api = ext.isActive
      ? ext.exports
      : await withSiblingTimeout(Promise.resolve(ext.activate()));
    // apiVersion gates the contract: a sibling predating the summary API (or a
    // future incompatible major) contributes nothing rather than a wrong shape.
    return api?.apiVersion === 1 ? api : undefined;
  } catch {
    return undefined;
  }
}

// One guarded API call. The payload crosses an extension boundary, so the call
// (may reject or hang), and the shape (may drift across versions) are all
// distrusted.
async function safeSummary(
  api: SuiteApi,
  date: string
): Promise<SuiteDailySummary | undefined> {
  try {
    const summary = await withSiblingTimeout(
      Promise.resolve(api.getDailySummary?.(date))
    );
    return isDailySummary(summary) ? summary : undefined;
  } catch {
    return undefined;
  }
}

// Runtime validation of the cross-extension payload — the structural equivalent
// of validating parsed JSON at a boundary.
function isDailySummary(value: unknown): value is SuiteDailySummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const s = value as Partial<SuiteDailySummary>;
  return (
    typeof s.tool === "string" &&
    typeof s.date === "string" &&
    typeof s.headline === "string" &&
    typeof s.counts === "object" &&
    s.counts !== null &&
    Array.isArray(s.trouble)
  );
}

// Exported for unit tests: pure over the telemetry store, the session registry,
// and the pre-fetched tool sections, so every branch is assertable without the
// extension host or live siblings.
export function buildDailyReport(
  store: ShortcutStore,
  today: string,
  tools: ToolSection[]
): string {
  const lines: string[] = [
    `# ${l10n("dailyReport.title", { date: today })}`,
    "",
    `> ${l10n("dailyReport.intro")}`,
    "",
  ];

  lines.push(...executiveSection(tools));
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
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

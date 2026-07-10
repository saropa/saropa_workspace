import * as vscode from "vscode";
import * as path from "path";
import { pollProcesses, formatBytes } from "./processPoll";
import { l10n } from "../i18n/l10n";

// Toolchain heartbeat (recipe book #61). On a timer (default every 15 min while a
// workspace is open) it samples the same toolchain set as the live monitor,
// unattended, and appends a row per tool to reports/process-trend.csv — so the
// trend is there when you look, and the live panel can draw a sparkline from it. It
// surfaces a toast ONLY when a threshold is crossed (a tool's RAM past a ceiling, or
// its helper-process count past a ceiling — the leaked-analysis-server and
// editor-helper-swarm cases). Silent when everything is within budget; the CSV
// still grows. It never kills anything — a breach badges and toasts, ending a
// process stays an explicit human act in the panel.
//
// Off by default (the safe-execution principle: an unattended sampler does not
// start on its own). Enabling it is the user's explicit opt-in via the setting.

const CSV_RELATIVE = "reports/process-trend.csv";
const CSV_HEADER = "timestamp,tool,cpuPercent,rssBytes,pidCount";

// Config keys, read fresh each tick so an edit takes effect without a reload.
const CONFIG = "saropaWorkspace.processMonitor";

// Owns the sampling timer: on each tick it polls the toolchain set, appends a CSV row
// per tool, and toasts (once per breach, via the latch below) when a tool crosses its
// RAM or helper-process ceiling. Re-arms itself whenever the process-monitor config
// changes, so an interval/enabled edit takes effect without a reload.
export class Heartbeat implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private readonly configListener: vscode.Disposable;
  // Per-threshold latch so a persistent breach toasts once, not every tick. Cleared
  // for a tool when it drops back under budget, so a later breach warns again.
  private readonly warned = new Set<string>();
  private disposed = false;

  constructor() {
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG)) {
        this.rearm();
      }
    });
    this.rearm();
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG);
  }

  // Arm or disarm the timer to match the current setting. A change to the interval
  // takes effect on the next arm.
  private rearm(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.disposed || !this.cfg().get<boolean>("heartbeat.enabled", false)) {
      return;
    }
    const minutes = Math.max(1, this.cfg().get<number>("heartbeat.intervalMinutes", 15));
    // setInterval, not a self-rescheduling timeout: the sample is cheap and a fixed
    // cadence is what a trend wants. The two-sample poll inside is ~1 s, far under
    // the minute-scale interval, so ticks never overlap in practice.
    this.timer = setInterval(() => void this.tick(), minutes * 60 * 1000);
  }

  private firstFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  private async tick(): Promise<void> {
    const folder = this.firstFolder();
    if (!folder) {
      return;
    }
    const result = await pollProcesses();
    await this.appendCsv(folder, result.sampledAt, result.groups);
    this.checkThresholds(result.groups);
  }

  // Append one row per tool group. Creates the file with a header on first write;
  // mkdir -p the reports folder so a fresh project does not fail the first sample.
  private async appendCsv(
    folder: vscode.WorkspaceFolder,
    sampledAt: number,
    groups: { tool: string; cpuPercent: number; rssBytes: number; pidCount: number }[]
  ): Promise<void> {
    const fs = await import("fs/promises");
    const file = path.join(folder.uri.fsPath, ...CSV_RELATIVE.split("/"));
    const stamp = new Date(sampledAt).toISOString();
    const rows = groups
      .map((g) => `${stamp},${csvField(g.tool)},${g.cpuPercent.toFixed(1)},${g.rssBytes},${g.pidCount}`)
      .join("\n");
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      let exists = true;
      try {
        await fs.access(file);
      } catch {
        exists = false;
      }
      const prefix = exists ? "" : CSV_HEADER + "\n";
      await fs.appendFile(file, prefix + rows + "\n", "utf8");
    } catch {
      // A failed trend write is non-fatal: the live monitor is unaffected, and the
      // next tick retries. Stay silent rather than nag on a transient IO error.
    }
  }

  // Toast on a newly-crossed ceiling, latched so a persistent breach warns once.
  private checkThresholds(
    groups: { tool: string; rssBytes: number; pidCount: number }[]
  ): void {
    const ramCeilingMB = this.cfg().get<number>("ramCeilingMB", 4096);
    const helperCeiling = this.cfg().get<number>("helperCountCeiling", 200);
    const ramCeilingBytes = ramCeilingMB * 1024 * 1024;

    for (const g of groups) {
      this.evaluate(
        `${g.tool}:ram`,
        g.rssBytes > ramCeilingBytes,
        () => l10n("monitor.heartbeat.ram", { tool: g.tool, rss: formatBytes(g.rssBytes), ceiling: formatBytes(ramCeilingBytes) })
      );
      this.evaluate(
        `${g.tool}:helpers`,
        g.pidCount > helperCeiling,
        () => l10n("monitor.heartbeat.helpers", { tool: g.tool, count: g.pidCount, ceiling: helperCeiling })
      );
    }
  }

  // One latched threshold: toast on the transition into breach, clear on recovery.
  private evaluate(key: string, breached: boolean, message: () => string): void {
    if (breached && !this.warned.has(key)) {
      this.warned.add(key);
      const open = l10n("monitor.heartbeat.openMonitor");
      void vscode.window.showWarningMessage(message(), open).then((choice) => {
        if (choice === open) {
          void vscode.commands.executeCommand("saropaWorkspace.openProcessMonitor");
        }
      });
    } else if (!breached) {
      this.warned.delete(key);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.configListener.dispose();
  }
}

// Escape a CSV field that may contain a comma (tool names do not today, but the
// quoting keeps the column count stable if one ever does).
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Read the trend CSV and return total CPU % per sample for the last `count`
// samples, in chronological order — the series the live panel draws as a sparkline.
// Rows are grouped by their timestamp (one sample writes one row per tool), and the
// per-tool CPU is summed. Returns [] when the file is absent or unreadable, so the
// panel simply omits the sparkline before any heartbeat has run.
export async function readTrendTotals(count: number): Promise<number[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const file = path.join(folder.uri.fsPath, ...CSV_RELATIVE.split("/"));
  let text: string;
  try {
    const fs = await import("fs/promises");
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  // Sum cpuPercent (column index 2) grouped by timestamp (column 0), preserving
  // first-seen order so the series reads left-to-right oldest-to-newest.
  const totals = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("timestamp,")) {
      continue;
    }
    const cols = line.split(",");
    if (cols.length < 5) {
      continue;
    }
    const stamp = cols[0];
    const cpu = Number(cols[cols.length - 3]);
    if (!Number.isFinite(cpu)) {
      continue;
    }
    totals.set(stamp, (totals.get(stamp) ?? 0) + cpu);
  }
  return [...totals.values()].slice(-count);
}

// A per-tool CPU time series over the last `count` samples, for the Trends tab's
// multi-line chart. Where readTrendTotals collapses every tool into one summed
// sparkline, this keeps each tool as its own line so a single hot toolchain is
// visible rather than hidden inside the total. Labels are the sample timestamps in
// chronological order; each tool's `points` array aligns to those labels, with 0
// filled in for a sample where that tool was absent (so all series share an x-axis).
// Returns empty arrays when the file is absent or unreadable, so the tab simply
// shows its no-data state before any heartbeat has run.
export interface TrendSeries {
  labels: string[];
  tools: { tool: string; points: number[] }[];
}

// Load the trend CSV for the current workspace and hand its text to parseTrendSeries
// for the actual grouping. This half owns only the file IO — an absent/unreadable
// file yields the empty TrendSeries above rather than throwing.
export async function readTrendSeries(count: number): Promise<TrendSeries> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return { labels: [], tools: [] };
  }
  const file = path.join(folder.uri.fsPath, ...CSV_RELATIVE.split("/"));
  let text: string;
  try {
    const fs = await import("fs/promises");
    text = await fs.readFile(file, "utf8");
  } catch {
    return { labels: [], tools: [] };
  }
  return parseTrendSeries(text, count);
}

// Pure CSV-to-series transform, split out from the file IO so it is unit-testable
// without the extension host (the project's pure-helper test convention). Groups
// cpuPercent by (timestamp, tool), preserving first-seen timestamp order so the
// series reads left-to-right oldest-to-newest, keeps the last `count` samples, and
// aligns every tool's points to that shared x-axis with 0 where the tool was absent.
export function parseTrendSeries(text: string, count: number): TrendSeries {
  const order: string[] = [];
  const perSample = new Map<string, Map<string, number>>();
  const toolSet = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("timestamp,")) {
      continue;
    }
    const cols = line.split(",");
    if (cols.length < 5) {
      continue;
    }
    const stamp = cols[0];
    // tool is everything between the timestamp and the trailing three numeric
    // columns, rejoined so a quoted tool name containing a comma stays intact.
    const tool = cols.slice(1, cols.length - 3).join(",").replace(/^"|"$/g, "");
    const cpu = Number(cols[cols.length - 3]);
    if (!Number.isFinite(cpu)) {
      continue;
    }
    if (!perSample.has(stamp)) {
      perSample.set(stamp, new Map());
      order.push(stamp);
    }
    perSample.get(stamp)?.set(tool, cpu);
    toolSet.add(tool);
  }
  const labels = order.slice(-count);
  const tools = [...toolSet].map((tool) => ({
    tool,
    points: labels.map((stamp) => perSample.get(stamp)?.get(tool) ?? 0),
  }));
  return { labels, tools };
}


import * as os from "os";
import * as vscode from "vscode";
// The byte formatter is centralized (BUG-012); this file used to carry its own copy,
// byte-identical to projectStats.ts's.
import { formatBytes } from "../utils/formatBytes";
import { sampleOnce, normalizeName } from "./processSample";

// Process-poll helper for the developer process monitor (recipe book section G,
// #60-62). It answers the one question the OS Task Manager buries under hundreds of
// undifferentiated rows: which tool in *this* project's toolchain is the hog right
// now. It samples the OS process table TWICE, ~1 s apart, and reports the CPU delta
// — never the raw cumulative CPU-seconds a single snapshot gives, which reads as a
// huge number for any long-lived process (an 8-hour-old analysis server shows a
// near-meaningless lifetime total even when it is idle now). Live load is the delta;
// memory is the working set.
//
// No new dependency: it shells out to the platform's own tools (PowerShell CIM on
// Windows, `ps` on macOS/Linux), parses the two samples, and computes the delta in
// process. Cross-platform behind one `sampleOnce()` branch.

// One process after the two-sample delta is computed.
export interface ProcSample {
  pid: number;
  ppid: number;
  name: string;
  rssBytes: number;
  // Live CPU load: (delta CPU ms / elapsed ms / logical cores) * 100. A process
  // present only in the second sample (started mid-interval) reports 0 — there is
  // no earlier baseline to subtract, so its load is unknown rather than inflated.
  cpuPercent: number;
}

// A toolchain group: every process attributed to one detected tool, rolled up the
// way Task Manager nests its helper processes under a single row.
export interface ToolGroup {
  // Display name of the tool, e.g. "Visual Studio Code", "Dart toolchain".
  tool: string;
  // Codicon id (no $(...)) for the group row.
  icon: string;
  // Roll-up of live CPU % and working-set RAM across every PID in the group.
  cpuPercent: number;
  rssBytes: number;
  pidCount: number;
  // Per-PID detail, sorted by CPU then RAM, so expanding a group shows the worst
  // offender first (the "which helper leaked" drill-down).
  procs: ProcSample[];
}

// The complete two-sample poll snapshot the panel renders: host totals (cores,
// RAM) plus the toolchain groups, sorted worst-first, that make up the table.
export interface PollResult {
  cores: number;
  totalRamBytes: number;
  freeRamBytes: number;
  // Tool groups sorted by roll-up CPU then RAM, so the hog leads.
  groups: ToolGroup[];
  sampledAt: number;
}

// A toolchain definition: the display name + icon for a group, and the executable
// base names (lowercased, without extension) that belong to it. `marker` gates a
// group on a project marker file so a Dart repo never surfaces a Python interpreter
// it never launched; the always-on groups (editor, agent, shells) have no marker.
interface ToolDef {
  tool: string;
  icon: string;
  names: string[];
  marker?: MarkerKey;
  // Container-runtime / OS-owned rows are never killable from the monitor. The
  // panel hides End task for any process whose group sets this.
  protectedGroup?: boolean;
}

// The marker files that switch a language toolchain group on, mirroring the recipe
// detector's marker table so the monitor's allowlist matches the project.
type MarkerKey =
  | "dart"
  | "node"
  | "python"
  | "rust"
  | "go"
  | "docker";

const TOOL_DEFS: readonly ToolDef[] = [
  // Always-on: every dev machine runs an editor, perhaps an AI agent, and shells.
  { tool: "Visual Studio Code", icon: "window", names: ["code", "code - insiders"] },
  { tool: "Cursor", icon: "window", names: ["cursor"] },
  { tool: "Claude", icon: "sparkle", names: ["claude"] },
  { tool: "Shells", icon: "terminal", names: ["pwsh", "powershell", "bash", "zsh", "sh", "cmd"] },
  // Language toolchains, each gated on a project marker.
  { tool: "Dart toolchain", icon: "symbol-method", marker: "dart", names: ["dart", "flutter", "flutter_tester", "gen_snapshot", "frontend_server", "dartaotruntime"] },
  { tool: "Node toolchain", icon: "server-process", marker: "node", names: ["node", "esbuild", "tsserver", "vite", "next", "webpack"] },
  { tool: "Python toolchain", icon: "symbol-misc", marker: "python", names: ["python", "python3", "pytest", "uvicorn", "gunicorn"] },
  { tool: "Rust toolchain", icon: "gear", marker: "rust", names: ["rust-analyzer", "cargo", "rustc"] },
  { tool: "Go toolchain", icon: "gear", marker: "go", names: ["gopls", "go", "dlv"] },
  { tool: "Docker", icon: "server-environment", marker: "docker", protectedGroup: true, names: ["com.docker.backend", "dockerd"] },
];

// Marker file(s) that switch a toolchain group on. Cheap folder-root stat only,
// matching the detector's no-recursive-crawl rule.
const MARKER_FILES: Record<MarkerKey, string[]> = {
  dart: ["pubspec.yaml", "analysis_options.yaml"],
  node: ["package.json"],
  python: ["pyproject.toml", "requirements.txt"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
  docker: ["docker-compose.yml", "compose.yaml"],
};

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// The set of toolchain groups applicable to the open workspace: the always-on
// groups, plus any marker-gated group whose marker file is present in a folder
// root. So the monitor's allowlist is project-aware — it never shows a toolchain
// the project does not use.
export async function activeToolDefs(): Promise<ToolDef[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const present = new Set<MarkerKey>();
  for (const folder of folders) {
    for (const [marker, names] of Object.entries(MARKER_FILES) as [MarkerKey, string[]][]) {
      if (present.has(marker)) {
        continue;
      }
      for (const name of names) {
        if (await fileExists(vscode.Uri.joinPath(folder.uri, name))) {
          present.add(marker);
          break;
        }
      }
    }
  }
  return TOOL_DEFS.filter((d) => !d.marker || present.has(d.marker));
}

// --- public poll --------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sample twice, ~intervalMs apart, compute each process's live CPU %, attribute
// every process to its detected toolchain group (walking the parent-PID chain so a
// helper inherits its launcher's tool), and roll up per group. Processes that match
// no active toolchain are dropped — the monitor is a project-aware view, not the
// full OS table.
export async function pollProcesses(intervalMs = 1000): Promise<PollResult> {
  const defs = await activeToolDefs();
  const first = await sampleOnce();
  const startedAt = Date.now();
  await delay(intervalMs);
  const second = await sampleOnce();
  const elapsed = Math.max(1, Date.now() - startedAt);
  const cores = os.cpus().length || 1;

  // name -> tool def, for direct attribution and the parent-walk.
  const nameToDef = new Map<string, ToolDef>();
  for (const def of defs) {
    for (const name of def.names) {
      nameToDef.set(name, def);
    }
  }

  // Resolve a process to its tool def: by its own name, else by walking up the
  // parent chain (a node child of Code, a dart process under the analysis server).
  // Capped hops and a visited set guard against a cycle or an orphaned ppid.
  const resolveDef = (pid: number): ToolDef | undefined => {
    let current: number | undefined = pid;
    const seen = new Set<number>();
    for (let hop = 0; hop < 12 && current !== undefined && !seen.has(current); hop++) {
      seen.add(current);
      const proc = second.get(current);
      if (!proc) {
        return undefined;
      }
      const def = nameToDef.get(normalizeName(proc.name));
      if (def) {
        return def;
      }
      current = proc.ppid === current ? undefined : proc.ppid;
    }
    return undefined;
  };

  const groups = new Map<string, ToolGroup>();
  for (const [pid, b] of second) {
    const def = resolveDef(pid);
    if (!def) {
      continue;
    }
    const a = first.get(pid);
    // A process new since the first sample has no baseline; report 0 rather than
    // crediting it with all of its lifetime CPU.
    const deltaCpu = a ? Math.max(0, b.cpuMs - a.cpuMs) : 0;
    const cpuPercent = (deltaCpu / elapsed / cores) * 100;
    const sample: ProcSample = { pid, ppid: b.ppid, name: b.name, rssBytes: b.rssBytes, cpuPercent };

    let group = groups.get(def.tool);
    if (!group) {
      group = { tool: def.tool, icon: def.icon, cpuPercent: 0, rssBytes: 0, pidCount: 0, procs: [] };
      groups.set(def.tool, group);
    }
    group.cpuPercent += cpuPercent;
    group.rssBytes += b.rssBytes;
    group.pidCount += 1;
    group.procs.push(sample);
  }

  // Sort each group's PIDs (worst first) and the groups themselves by load.
  const ordered = [...groups.values()];
  for (const group of ordered) {
    group.procs.sort((x, y) => y.cpuPercent - x.cpuPercent || y.rssBytes - x.rssBytes);
  }
  ordered.sort((x, y) => y.cpuPercent - x.cpuPercent || y.rssBytes - x.rssBytes);

  return {
    cores,
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    groups: ordered,
    sampledAt: Date.now(),
  };
}

// Whether a tool group's processes may be ended from the monitor. Container-runtime
// and OS-owned rows are never killable here (see the safety note in the recipe
// book): the only mutating action is a confirm-gated, single-PID End task on a
// developer process the user owns.
export function isGroupKillable(tool: string): boolean {
  const def = TOOL_DEFS.find((d) => d.tool === tool);
  return def !== undefined && def.protectedGroup !== true;
}

// The grouped, two-sample-CPU table as Markdown — the artifact a "my machine is
// thrashing" report attaches (#62), and the text the panel's Copy action writes to
// the clipboard. One source so the snapshot file and the clipboard copy never drift.
export function buildProcessReportMarkdown(result: PollResult): string {
  const lines: string[] = [];
  lines.push("# Toolchain process snapshot");
  lines.push("");
  lines.push(`Generated ${new Date(result.sampledAt).toLocaleString()}`);
  lines.push(
    `Host: ${result.cores} logical cores, ` +
      `${formatBytes(result.totalRamBytes)} RAM ` +
      `(${formatBytes(result.totalRamBytes - result.freeRamBytes)} in use)`
  );
  lines.push("");
  lines.push("CPU % is a live two-sample delta (load right now), not cumulative CPU time.");
  lines.push("");
  lines.push("| Tool | CPU % | RAM | Processes |");
  lines.push("|------|------:|----:|----------:|");
  for (const group of result.groups) {
    lines.push(
      `| ${group.tool} | ${group.cpuPercent.toFixed(1)} | ${formatBytes(group.rssBytes)} | ${group.pidCount} |`
    );
  }
  lines.push("");
  // Per-tool PID detail, so the report carries the drill-down the panel expands to.
  for (const group of result.groups) {
    lines.push(`## ${group.tool} (${group.pidCount} processes)`);
    lines.push("");
    lines.push("| PID | Name | CPU % | RAM |");
    lines.push("|----:|------|------:|----:|");
    for (const proc of group.procs) {
      lines.push(
        `| ${proc.pid} | ${proc.name} | ${proc.cpuPercent.toFixed(1)} | ${formatBytes(proc.rssBytes)} |`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

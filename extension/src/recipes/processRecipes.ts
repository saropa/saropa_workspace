import * as vscode from "vscode";
import { RecipeResult } from "./detectors";

// Developer process monitor recipes (recipe book section G). This file ships the
// quick, always-applicable slice — the one-shot toolchain SNAPSHOT (#62) — which
// reuses the existing shell-to-report machinery (a shell action with reportFile +
// autoOpen, exactly like the scheduled rituals). The live grouped panel (#60) and
// the heartbeat (#61) need a process-poll helper and a webview and are not built
// here.
//
// The snapshot is "basic" by design: it captures the OS process table as-is at one
// instant, so its CPU column is the cumulative CPU-time the OS reports, NOT the
// two-sample live delta the full monitor will use. It is still the useful artifact
// to attach to a "my machine is thrashing" report.

// The capture command must run under the shell that runShellToReport uses:
// cp.spawn(cmd, { shell: true }) — cmd.exe on Windows, /bin/sh elsewhere. So the
// Windows command stays pure cmd (tasklist, no PowerShell quoting), and the POSIX
// command uses a plain sh pipeline.
function snapshotCommand(): string {
  if (process.platform === "win32") {
    // tasklist is a built-in cmd command; /v adds the CPU-time and memory columns.
    // cmd cannot sort, so the table is unsorted (acceptable for a basic snapshot).
    return "tasklist /v /fo table";
  }
  // ps + sort by %CPU descending, top 40, so the heaviest processes lead the file.
  return "ps -axo pid,ppid,pcpu,pmem,rss,comm | sort -k3 -nr | head -n 40";
}

export async function detectProcessRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  // Always applicable: every dev machine runs processes, so no marker-file gate.
  return [
    {
      recipeId: "monitor.snapshot",
      label: "Snapshot the toolchain",
      description:
        "Captures the current OS process table to a dated report under reports/ and opens it — a shareable record of what was resident and how hard it was working, to attach to a bug or a slow-machine report. Basic snapshot: the CPU column is the OS's cumulative CPU time, not a live delta (the grouped, two-sample monitor is a later addition).",
      icon: "device-desktop",
      color: "charts.red",
      group: "monitor",
      action: {
        kind: "shell",
        shellCommand: snapshotCommand(),
        cwd: folder.uri.fsPath,
        reportFile: "reports/$stamp_processes.md",
        autoOpen: true,
      },
    },
  ];
}

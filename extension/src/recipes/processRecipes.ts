import * as vscode from "vscode";
import { RecipeResult } from "./detectors";

// Developer process monitor recipes (recipe book section G). Now backed by the
// process-poll helper, so all three land here:
//   - #60 the live grouped panel (the Saropa Dashboard webview): only your detected
//     toolchain's processes, rolled up per tool, sorted by live load, with a
//     confirm-gated End task for a runaway PID.
//   - #62 the grouped snapshot: the two-sample, per-tool rolled-up table written to
//     a dated report and opened — the upgrade over the old one-instant tasklist/ps
//     capture (the CPU column is now a live delta, not cumulative CPU time).
// The heartbeat (#61) is not a shortcut — it is a setting-gated background sampler
// wired at activation, so it has no recipe row here.

export async function detectProcessRecipes(
  _folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  // Always applicable: every dev machine runs processes, so no marker-file gate.
  // The allowlist of which processes to show is derived from the project's marker
  // files inside the poll helper, not here.
  return [
    {
      recipeId: "monitor.live",
      label: "Open the toolchain monitor",
      description:
        "Opens the live process monitor (the Saropa Dashboard): only your detected toolchain's processes — editor, language servers, AI agents, dev servers, shells — grouped per tool with a live CPU bar and total RAM, sorted by load so the hog leads. Expand a tool to see its PIDs; end a single runaway with a confirm-gated End task. CPU is a two-sample live delta, not cumulative CPU time.",
      icon: "pulse",
      color: "charts.red",
      group: "monitor",
      action: { kind: "command", commandId: "saropaWorkspace.openProcessMonitor" },
    },
    {
      recipeId: "monitor.snapshot",
      label: "Snapshot the toolchain",
      description:
        "Writes the grouped toolchain process table to a dated report under reports/ and opens it — a shareable record of what was resident and how hard it was working, to attach to a bug or a slow-machine report. The CPU column is a live two-sample delta (load right now), rolled up per tool with a per-PID breakdown.",
      icon: "device-desktop",
      color: "charts.red",
      group: "monitor",
      action: { kind: "command", commandId: "saropaWorkspace.recipe.snapshotProcesses" },
    },
  ];
}

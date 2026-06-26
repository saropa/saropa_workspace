import * as vscode from "vscode";
import { RecipeResult } from "./detectors";

// Workspace hygiene scan recipe (recipe book section H, #63). Always applicable —
// every project can be scanned for empty/oversized outliers — so there is no
// marker-file gate; it lands in the Workspace recipe group. The recipe is a command
// pin that runs the recursive scan, writes a dated JSON report, and raises a sticky
// toast. The crawl is explicit and user-run (the "no full disk crawl" rule governs
// auto-detection, not a scan the user asks for); thresholds, mode, and excludes come
// from the saropaWorkspace.hygiene.* settings.
export async function detectHygieneRecipes(
  _folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  return [
    {
      recipeId: "hygiene.scan",
      label: "Scan for empty & oversized files",
      description:
        "Recursively crawls the project and reports outliers at the extremes — empty (zero-byte files, zero-child folders) and oversized (files and folders past a size ceiling) — then writes a dated reports/<date>/<time>_filereport.json and raises a sticky notification naming the issue count with an Open report action. Mode, thresholds, .gitignore handling, and exclude globs are configurable under saropaWorkspace.hygiene; the built-in ignore set keeps the crawl out of node_modules / .git / build output.",
      icon: "search",
      color: "charts.blue",
      group: "workspace",
      action: { kind: "command", commandId: "saropaWorkspace.recipe.runHygieneScan" },
    },
    {
      // #63 "Workspace bloat scan": the directory-bloat half. VS Code crawls the whole
      // workspace on folder-open except node_modules / .git, so any immediate child
      // dir that has grown large and is not in files.watcherExclude pins a CPU core
      // and freezes the window. Seeds DISABLED at 04:45 (ahead of the 05:00 dawn lint)
      // so a bloated tree is caught before the heavier morning members.
      recipeId: "hygiene.bloat",
      label: "Workspace bloat scan",
      description:
        "Scheduled (daily, default 04:45, seeds disabled): measures the directories VS Code crawls on folder-open (each immediate child except node_modules / .git) and flags any past a size or file-count ceiling that is NOT in files.watcherExclude — the bloat that pins a CPU core and freezes the editor. Also flags a project that depends on @vscode/test-(electron|cli) but does not exclude **/.vscode-test/** (the test downloader grows that cache without bound). Writes reports/<stamp>_workspace_hygiene.md with the exact files.watcherExclude line to add; auto-opens and warns only when a finding crosses a ceiling, silent when clean. Offers Guard this project / Prune .vscode-test for the open workspace. Ceilings and an optional cross-project root list are configurable under saropaWorkspace.hygiene.",
      icon: "warning",
      color: "charts.orange",
      group: "scheduled",
      schedule: { atTime: "04:45", enabled: false },
      action: { kind: "command", commandId: "saropaWorkspace.recipe.runBloatScan" },
    },
  ];
}

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
  ];
}

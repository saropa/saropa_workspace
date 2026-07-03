import * as vscode from "vscode";
import { getGitRemote } from "./gitMeta";
import { readJson } from "./detectorHelpers";
import { pushUrlRecipes } from "./detectorUrlRecipes";
import { RecipeResult } from "./detectors";

// Discovering the high-value URLs already declared by a project — its git remote's
// web views, the package.json / pubspec / pyproject / mkdocs URLs — so the user can
// turn them into website shortcuts without hand-typing. This reuses the URL-opener
// recipe derivation verbatim (pushUrlRecipes) rather than text-scraping the tree: the
// candidate set is exactly what the recipes already prove is real, so it is near-zero
// noise (no XML schemas, no localhost, no test fixtures). Structured sources only.

export interface UrlCandidate {
  // The display name (the recipe's descriptive label, e.g. "Open Issues"); the user
  // can rename the shortcut afterward.
  label: string;
  // The href a single click opens.
  url: string;
  // What it is and where it was detected from (the recipe description), shown as the
  // QuickPick detail line.
  description?: string;
  // Codicon id (no surrounding $(...)) for the QuickPick row, mirroring the recipe.
  icon?: string;
}

// Pure: map the URL-opener recipe results to plain candidates and drop duplicate
// hrefs, keeping the first label seen. The same URL can arise from more than one
// source (a homepage that equals the repo web base, or the same remote across two
// workspace folders), so dedup by href is what keeps the picker clean. Exported so it
// is unit-testable without the vscode host — it takes RecipeResults, not the fs.
export function urlCandidatesFromRecipes(results: RecipeResult[]): UrlCandidate[] {
  const seen = new Set<string>();
  const out: UrlCandidate[] = [];
  for (const result of results) {
    // pushUrlRecipes only ever emits url actions, but narrow defensively: the flat
    // ShortcutAction carries url as optional, so prove it is a string before using it.
    const action = result.action;
    if (action?.kind !== "url" || typeof action.url !== "string") {
      continue;
    }
    if (seen.has(action.url)) {
      continue;
    }
    seen.add(action.url);
    out.push({
      label: result.label,
      url: action.url,
      description: result.description,
      icon: result.icon,
    });
  }
  return out;
}

// Gather high-value URL candidates from every open workspace folder's structured
// sources. Runs the same per-folder derivation the recipe catalog uses (git remote +
// manifests), then flattens and dedupes by href. No recursive crawl and no regex over
// file contents — only the well-known files each detector already reads at the folder
// root. Returns an empty list when no folder is open or nothing is declared.
export async function detectUrlCandidates(): Promise<UrlCandidate[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const results: RecipeResult[] = [];
  for (const folder of folders) {
    const pkg = await readJson<Record<string, unknown>>(folder, "package.json");
    const remote = await getGitRemote(folder);
    await pushUrlRecipes(folder, pkg, remote, results);
  }
  return urlCandidatesFromRecipes(results);
}

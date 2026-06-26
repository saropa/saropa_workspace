import * as vscode from "vscode";
import { ShortcutAction, ShortcutSchedule } from "../model/shortcut";
import { getGitRemote } from "./gitMeta";
import { readJson } from "./detectorHelpers";
import { pushRunTargets } from "./detectorRunTargets";
import { pushUrlRecipes } from "./detectorUrlRecipes";
import { pushWorkspaceRecipes } from "./detectorWorkspaceRecipes";

// Roadmap recipe book — detectors. Each looks at well-known files in a workspace
// folder root (never a recursive crawl) and returns zero or more recipes derived
// from what it finds. The store seeds the results as auto-detected shortcuts; removal
// is sticky and they can be restored (mirrors the auto-shortcut mechanism). Recipes are
// detected, never "created" by a standing button.

// The logical category a recipe belongs to, used to route it into a top-level
// group. Mirrors the recipe book sections: A (open) / B (run) / C+D (workspace) /
// E (scheduled) / F (suite).
export type RecipeCategory =
  | "open"
  | "run"
  | "workspace"
  | "scheduled"
  | "suite"
  | "monitor"
  | "ai";

export interface RecipeResult {
  // Stable per-recipe id (combined with the folder for the shortcut id), so sticky
  // removal and de-duplication survive reloads.
  recipeId: string;
  label: string;
  // What the recipe does and what it was detected from, surfaced on the
  // single-click detail modal and the tree hover. The label is the short row
  // text; this is the fuller explanation a user reads before running it.
  description?: string;
  icon?: string;
  color?: string;
  // Optional schedule (the scheduled-ritual recipes set this).
  schedule?: ShortcutSchedule;
  // Which logical top-level group the seeded shortcut lands in, mirroring the recipe
  // book's catalog sections. The store maps each category to its own synthetic
  // group (Recipes: Open / Run / Workspace / Scheduled, and Saropa Suite) instead
  // of piling every recipe into one flat "Recipes" folder. Undefined falls back to
  // "open" (see recipeGroupId in ShortcutStore).
  group?: RecipeCategory;
  // Optional per-tool subgroup key within the category's top-level group. The suite
  // recipes set this ("lints" / "drift" / "log") so each tool's shortcuts nest under
  // their own subfolder beneath "Saropa Suite" instead of sitting flat in one suite
  // group; the store maps it to a synthetic subgroup id (see recipeSubGroupId in
  // ShortcutStore). Undefined keeps the shortcut directly under the category's top-level
  // group — the boot macro stays at the suite top level this way.
  subGroup?: string;
  // Exactly one of these defines the action:
  filePath?: string; // a file shortcut, path relative to the folder
  action?: ShortcutAction; // a non-file shortcut (url / shell / command / macro)
}

// This file is the catalog orchestrator. The recipe blocks themselves live in
// sibling modules so each stays a focused, readable unit: the URL openers (git
// web views, registries, docs) in detectorUrlRecipes; the run-target shell recipes
// in detectorRunTargets; the workspace actions (entry, docs, env, config, boot,
// localhost, copy-version, nearest-script) in detectorWorkspaceRecipes. The fs and
// action helpers live in detectorHelpers; the ecosystem probes in detectorEcosystem.

// --- the catalog (recipes 1-25, 66-72) ---------------------------------

export async function detectOnDemandRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  const pkg = await readJson<Record<string, unknown>>(folder, "package.json");
  const remote = await getGitRemote(folder);

  // Each pusher appends in catalog order: URL openers (1-8, 23, 25), then the
  // run-target shell recipes (9-16, 66-68), then the workspace actions (17-22, 24,
  // 69-72). Ordering is preserved so the seeded shortcut layout is unchanged.
  await pushUrlRecipes(folder, pkg, remote, out);
  await pushRunTargets(folder, pkg, out);
  await pushWorkspaceRecipes(folder, pkg, out);

  categorizeRecipes(out);
  return out;
}

// Route each recipe to a logical top-level group by its id, so the catalog no
// longer lands in one flat "Recipes" folder. Run-target recipes (9-16) and the
// nearest-script runner are "run"; entry/.env/config/boot/copy are "workspace";
// everything else here opens a place ("open"). Centralized in one block so a new
// recipe is categorized in the same file the orchestration lives in.
function categorizeRecipes(out: RecipeResult[]): void {
  const RUN = new Set([
    "dev", "test", "lint", "build", "install", "typecheck",
    "compose.up", "db.migrate", "nearest.script",
    "format", "clean", "upgrade",
  ]);
  const WORKSPACE = new Set([
    "entry", "env.setup", "config.open", "boot", "copy.version",
  ]);
  for (const r of out) {
    r.group = RUN.has(r.recipeId)
      ? "run"
      : WORKSPACE.has(r.recipeId)
        ? "workspace"
        : "open";
  }
}

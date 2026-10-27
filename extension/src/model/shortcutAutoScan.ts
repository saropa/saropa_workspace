// Detection helpers for the recipe/auto-shortcut layer that need no store state: glob
// resolution of the auto-shortcut patterns, the sample-config shortcut and the set of
// recipes the user already runs. Split out of shortcutStoreRecipes.ts.

import * as vscode from "vscode";
import {
  Shortcut,
  ProjectShortcutsFile,
  PROJECT_FILE_RELATIVE,
  configuredProjectFileRelative,
} from "./shortcut";

import { RecipeResult } from "../recipes/detectors";

import { telemetry } from "../exec/telemetry";

import { l10n } from "../i18n/l10n";
import { isGlobPattern } from "./shortcutStoreShared";

// Resolve the auto-shortcut patterns for a folder to matched relative paths: an
// exact-name pattern is a single fs.stat, a real glob goes through findFiles.
export async function globAutoShortcutPaths(
  folder: vscode.WorkspaceFolder,
  patterns: string[],
  toFolderRelative: (uri: vscode.Uri) => string
): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (relative: string): void => {
    if (!seen.has(relative)) {
      seen.add(relative);
      paths.push(relative);
    }
  };
  for (const pattern of patterns) {
    // BUG FIX (2026-06-25, slow startup): an exact-name pattern (no glob
    // metacharacters) can only ever match the one file at that relative path —
    // a RelativePattern without `**` does not recurse — so resolve it with a
    // single fs.stat instead of vscode.workspace.findFiles. findFiles spins up
    // the workspace search service (a full file-tree walk) even when the file
    // is absent, and this is the ONLY search-service call on the awaited
    // activation path (store.init -> refresh -> seedAutoShortcuts). For the default
    // `pubspec.yaml` + `analysis_options.yaml` patterns that meant two
    // whole-workspace searches on every launch — wasted entirely in a project
    // that has neither (the common non-Dart case). A direct stat turns each
    // into an instant hit/miss.
    if (!isGlobPattern(pattern)) {
      const uri = vscode.Uri.joinPath(folder.uri, pattern);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.File) {
          add(toFolderRelative(uri));
        }
      } catch {
        // Absent — the normal case for a pattern that does not apply here.
      }
      continue;
    }
    // A real glob still needs the search service to expand it. Limit each
    // pattern to a small result set; auto-shortcuts are a convenience, not a
    // project-wide scan.
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, pattern),
      "**/node_modules/**",
      50
    );
    for (const uri of matches) {
      add(toFolderRelative(uri));
    }
  }
  return paths;
}

// Build the synthetic "Workspace config" example shortcut for a folder, or
// undefined when it should not appear. It links to the folder's own config file so
// a brand-new project still has one working shortcut. Returns undefined when the
// user removed it (sticky via removedAutoPins) or when a stored/auto shortcut
// already targets the config file, which avoids duplicating a project's own
// committed config shortcut (e.g. this repo's sample-config). The id matches the
// auto-shortcut scheme so removeShortcut's isAuto branch suppresses it the same way.
export function buildConfigExampleShortcut(
  folder: vscode.WorkspaceFolder,
  file: ProjectShortcutsFile,
  autoShortcuts: readonly Shortcut[]
): Shortcut | undefined {
  const configPath = configuredProjectFileRelative();
  const id = `auto:${folder.name}:${configPath}`;
  // Accept the old id too so a removal persisted under the previous configDir
  // keeps sticking after the user changes the setting.
  const legacyId = `auto:${folder.name}:${PROJECT_FILE_RELATIVE}`;
  if (
    file.removedAutoPins.includes(id) ||
    file.removedAutoPins.includes(legacyId)
  ) {
    return undefined;
  }
  const alreadyAdded =
    file.pins.some((p) => p.path === configPath) ||
    autoShortcuts.some((p) => p.path === configPath);
  if (alreadyAdded) {
    return undefined;
  }
  return {
    id,
    path: configPath,
    label: l10n("pin.sampleConfig"),
    scope: "project",
    isAuto: true,
    // Re-apply the folder the user dragged the config shortcut into, if any.
    groupId: file.autoGroups[id],
    // Negative order sorts it ahead of explicit shortcuts (order >= 0), so the
    // example sits at the top of the Project scope.
    order: -1,
  };
}

// recipeIds the user has already RUN on demand, used to demote them from the curated /
// aggressive picks (a recipe in use no longer needs featuring). A run records local
// telemetry under the shortcut id it ran from: the home-category row (`recipe:`) or the
// shelf pointer (`recommend:`), so both ids are checked. Disabled rituals are not
// demoted by this (see RecommendedSelectionOptions). Returns an empty set when telemetry
// is disabled — count() reads 0 for every id then, so nothing is demoted.
export function collectAdoptedRecipeIds(
  folder: vscode.WorkspaceFolder,
  results: readonly RecipeResult[]
): Set<string> {
  const adopted = new Set<string>();
  for (const r of results) {
    const ranFromCategory = telemetry.count(`recipe:${folder.name}:${r.recipeId}`) > 0;
    const ranFromShelf = telemetry.count(`recommend:${folder.name}:${r.recipeId}`) > 0;
    if (ranFromCategory || ranFromShelf) {
      adopted.add(r.recipeId);
    }
  }
  return adopted;
}

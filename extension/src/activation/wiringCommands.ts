import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { DoubleClickDispatcher } from "../exec/doubleClick";
import { BranchTracker } from "../exec/gitBranch";
import { BranchSetBinder } from "../exec/branchSets";
import { setRoutineHooks } from "../exec/runner";
import { PlannerPanel } from "../views/plannerPanel";
import { registerSimulationPreview } from "../commands/simulateRun";
import { registerRunAnalytics } from "../commands/runAnalytics";
import { registerRunOutputDiff } from "../commands/diffRuns";
import { registerShortcutCommands, createRoutineHooks } from "../commands/shortcutCommands";
import { registerSetCommands } from "../commands/setCommands";
import { registerBranchSetCommands } from "../commands/branchSetCommands";
import { registerProcessMonitorCommands } from "../exec/processMonitorCommands";
import { registerHygieneCommands } from "../exec/hygieneCommands";
import { registerBloatCommands } from "../exec/bloatCommands";
import { registerProjectStatsCommand } from "../exec/projectStats";
import { registerPubspecOutdatedCommand } from "../exec/pubspecOutdated";
import { registerRecipeCommands } from "../recipes/recipeCommands";
import { handleShortcutImportUri } from "./activationHelpers";

// Activation wiring block split out of extension.ts (and, before that, out of
// wiring.ts once that file itself grew past the project's line-count cap) so
// activate() stays a short, readable sequence of named steps.

// Register the command-module subsystems and the routine hooks; returns the
// branch-set binder (the config watcher re-applies it on a settings change).
export function registerCommandModules(
  context: vscode.ExtensionContext,
  store: ShortcutStore,
  dispatcher: DoubleClickDispatcher,
  branchTracker: BranchTracker
): BranchSetBinder {
  registerSimulationPreview(context);
  registerRunAnalytics(context);
  registerRunOutputDiff(context);
  registerShortcutCommands(context, store, dispatcher);

  // Named shortcut sets (multiple-favorite-sets roadmap): switch / create / rename /
  // delete / duplicate. The active set's project shortcuts are the tree's project
  // shortcuts, so switching simply swaps which set is live; global shortcuts stay
  // shared. The status-bar switcher below is the discoverable entry point.
  registerSetCommands(context, store);

  // Branch-aware shortcut sets (roadmap 3.2): bind a git branch to a shortcut set so
  // the active set follows the current branch on checkout. Built on the existing branch
  // tracker + named-set API; gated by saropaWorkspace.branchAware.enabled (off by
  // default, so single-set / non-git users see no change). Constructed before
  // branchTracker.init() below so it catches the initial branch read and aligns the
  // set to the current branch on open. Disposable so its tracker subscription is
  // released on deactivation.
  const branchSetBinder = new BranchSetBinder(context, store, branchTracker);
  context.subscriptions.push(branchSetBinder);
  registerBranchSetCommands(context, store, branchSetBinder);

  // Inject the routine engine's resolve + run hooks now that the store exists (the
  // runner cannot import the store/command layer without a cycle). A routine
  // shortcut's members are resolved and run through the same single-shortcut path the
  // tree uses.
  setRoutineHooks(createRoutineHooks(store));

  // Handle vscode://saropa.saropa-workspace/import?data=... links (WOW #4 import), so
  // a shared shortcut link opens VS Code, confirms, and adds the shortcut. Registered
  // as a disposable so the handler is torn down on deactivation.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => void handleShortcutImportUri(uri, store),
    })
  );
  // Helper commands invoked by "command" recipes (set up .env, open config files,
  // copy version, run nearest script).
  registerRecipeCommands(context);

  // Saropa Dashboard (roadmap 3.4): the openDashboard command (three tabs —
  // Processes / Analytics / Trends), the openProcessMonitor alias (#60) that opens
  // the Processes tab, and the grouped-snapshot command (#62). The store backs the
  // Analytics tab's shortcut-name resolution.
  registerProcessMonitorCommands(context, store);

  // Workspace hygiene scanner (recipe book section H, #63): the recursive
  // empty/oversized outlier scan that writes a dated JSON report and a sticky toast,
  // plus the per-instance saved-scan wizard.
  registerHygieneCommands(context, store);

  // Workspace bloat scan (#63): the directory-bloat half — measures the dirs VS Code
  // crawls on open + the test-downloader watcher guard, writes a dated Markdown
  // report, and offers Guard / Prune remediation for the open workspace.
  registerBloatCommands(context);

  // Sunrise project stats (#27): the per-language file/line aggregation + git
  // activity summary command, driven by the scheduled "Sunrise project stats" recipe.
  registerProjectStatsCommand(context);

  // Pubspec dependency freshness (#30, pubspec projects): parses `dart pub outdated
  // --json` and writes a report of ONLY the packages behind latest, driven by the
  // scheduled "Dependency freshness" recipe.
  registerPubspecOutdatedCommand(context);

  // Schedule & Workflow Planner webview: the visual day/week timelines and the
  // chained-trigger graph. Opens (or reveals the single instance of) the panel.
  context.subscriptions.push(
    vscode.commands.registerCommand("saropaWorkspace.openPlanner", () =>
      PlannerPanel.show(context, store)
    )
  );
  return branchSetBinder;
}

import * as vscode from "vscode";
import * as path from "path";
import { Shortcut } from "../model/shortcut";
import { telemetry, RunSource } from "./telemetry";
import { playCue } from "./soundCue";
import { shortcutEvents } from "./shortcutEvents";
import {
  hasInteractiveTokens,
  resolveInteractiveTokens,
  cloneWithResolvedTokens,
} from "./promptTokens";
import { l10n } from "../i18n/l10n";
import { planRun } from "./runPlanning";
import { getOutputChannel, runInTerminal } from "./terminalRunner";
import { runInExternal } from "./externalLauncher";
import { runInBackground } from "./backgroundRunner";

// Builds and launches the command for a file shortcut, routing to the resolved location
// (integrated terminal / background channel / external OS window). The per-location
// launchers, the run planning + single-instance guard, the non-file action handlers,
// and the shared terminal/output singletons each live in their own sibling module:
//   - runPlanning      planRun / isRunnable / runBlockReason (pure assembly + guard)
//   - terminalRunner   getOutputChannel / runInTerminal (shared singletons)
//   - externalLauncher runInExternal (per-platform new OS window)
//   - backgroundRunner runInBackground (child + settle + completion handling)
//   - actionRunner     runAction (url/command/shell/macro/routine) + expandRecipeTokens
//
// Re-exported here so every existing importer keeps reaching these from "./runner".
export {
  isRunnable,
  planRun,
  RunPlan,
  runBlockReason,
  blockReasonLabel,
  RunBlockReason,
} from "./runPlanning";
export { getOutputChannel, registerTerminalCleanup } from "./terminalRunner";
export {
  runAction,
  setRoutineHooks,
  RoutineHooks,
  expandRecipeTokens,
} from "./actionRunner";

// `source` distinguishes a user-triggered run ("manual", the default) from an
// unattended scheduled fire ("scheduled", passed by the Scheduler) for the local
// run telemetry that feeds the Recent group and the palette's recents.
export async function runShortcut(
  shortcut: Shortcut,
  uri: vscode.Uri,
  source: RunSource = "manual",
  extraTokens?: Record<string, string>
): Promise<void> {
  const name = shortcut.label ?? path.basename(uri.fsPath);

  // Resolve interactive run-parameter tokens (${prompt:...} / ${pick:...}) before
  // assembly, so the run uses the values the user just entered. Canceling any
  // prompt aborts the run with nothing executed; the stored shortcut is untouched, as
  // the substitution applies only to this run.
  let effectiveShortcut = shortcut;
  if (hasInteractiveTokens(shortcut)) {
    const resolved = await resolveInteractiveTokens(shortcut);
    if (resolved === undefined) {
      getOutputChannel().appendLine(
        l10n("run.canceledPrompt", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.canceledPromptToast", { name }));
      return;
    }
    effectiveShortcut = cloneWithResolvedTokens(shortcut, resolved);
  }

  const plan = planRun(effectiveShortcut, uri, extraTokens);

  // Note unrecognized $tokens once so they are visibly left literal rather than
  // silently dropped (acceptance 2.4).
  if (plan.unknownTokens.length > 0) {
    getOutputChannel().appendLine(
      l10n("run.unknownTokens", {
        tokens: plan.unknownTokens.map((t) => `$${t}`).join(", "),
      })
    );
  }

  // Record the run for the Recent group and the palette's recents (after the
  // cancel checks above, so an aborted interactive prompt does not count as a run).
  void telemetry.record(shortcut.id, source);

  vscode.window.showInformationMessage(l10n("run.starting", { name: plan.name }));

  // Audio start cue (#64), honoring the shortcut's per-shortcut override. Fires for every
  // location; terminal/external runs get no finish cue because VS Code cannot track
  // their exit, so the start cue is their only audio acknowledgment.
  playCue("start", effectiveShortcut.exec?.sound);

  // Route to the resolved location. An external run launches a separate OS
  // terminal window and returns immediately — VS Code cannot track its exit, so
  // it is not registered for Stop and gets no completion toast (the new window is
  // itself the visible feedback).
  switch (plan.location) {
    case "terminal":
      runInTerminal(plan.commandLine, plan.cwd, plan.env);
      // Terminal runs have no tracked exit, so chaining keys off dispatch: the
      // dependent fires as soon as the command is sent. Background fires its real
      // outcome from settle() instead (so it is excluded here).
      shortcutEvents.fireComplete(shortcut.id, "dispatched");
      break;
    case "external":
      await runInExternal(plan.commandLine, plan.cwd, plan.env, plan.elevated, plan.name);
      // External windows are fire-and-forget too: chain off the dispatch.
      shortcutEvents.fireComplete(shortcut.id, "dispatched");
      break;
    case "background":
      await runInBackground(
        plan.commandLine,
        plan.cwd,
        plan.env,
        plan.name,
        shortcut.id,
        plan.extractResult,
        effectiveShortcut.exec?.sound,
        // Re-run from the original shortcut (not effectiveShortcut) so a kill+retry re-resolves
        // any interactive ${prompt:}/${pick:} tokens, matching a fresh manual run.
        () => void runShortcut(shortcut, uri, source, extraTokens),
        // Cross-process lock held for this run's lifetime when the shortcut opts in.
        shortcut.lockName
      );
      break;
  }
}

import * as vscode from "vscode";
import * as path from "path";
import { Pin } from "../model/pin";
import { telemetry, RunSource } from "./telemetry";
import { playCue } from "./soundCue";
import { pinEvents } from "./pinEvents";
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

// Builds and launches the command for a file pin, routing to the resolved location
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
export async function runPin(
  pin: Pin,
  uri: vscode.Uri,
  source: RunSource = "manual",
  extraTokens?: Record<string, string>
): Promise<void> {
  const name = pin.label ?? path.basename(uri.fsPath);

  // Resolve interactive run-parameter tokens (${prompt:...} / ${pick:...}) before
  // assembly, so the run uses the values the user just entered. Canceling any
  // prompt aborts the run with nothing executed; the stored pin is untouched, as
  // the substitution applies only to this run.
  let effectivePin = pin;
  if (hasInteractiveTokens(pin)) {
    const resolved = await resolveInteractiveTokens(pin);
    if (resolved === undefined) {
      getOutputChannel().appendLine(
        l10n("run.canceledPrompt", { time: new Date().toLocaleString(), name })
      );
      vscode.window.showInformationMessage(l10n("run.canceledPromptToast", { name }));
      return;
    }
    effectivePin = cloneWithResolvedTokens(pin, resolved);
  }

  const plan = planRun(effectivePin, uri, extraTokens);

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
  void telemetry.record(pin.id, source);

  vscode.window.showInformationMessage(l10n("run.starting", { name: plan.name }));

  // Audio start cue (#64), honoring the pin's per-pin override. Fires for every
  // location; terminal/external runs get no finish cue because VS Code cannot track
  // their exit, so the start cue is their only audio acknowledgment.
  playCue("start", effectivePin.exec?.sound);

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
      pinEvents.fireComplete(pin.id, "dispatched");
      break;
    case "external":
      await runInExternal(plan.commandLine, plan.cwd, plan.env, plan.elevated, plan.name);
      // External windows are fire-and-forget too: chain off the dispatch.
      pinEvents.fireComplete(pin.id, "dispatched");
      break;
    case "background":
      await runInBackground(
        plan.commandLine,
        plan.cwd,
        plan.env,
        plan.name,
        pin.id,
        plan.extractResult,
        effectivePin.exec?.sound,
        // Re-run from the original pin (not effectivePin) so a kill+retry re-resolves
        // any interactive ${prompt:}/${pick:} tokens, matching a fresh manual run.
        () => void runPin(pin, uri, source, extraTokens),
        // Cross-process lock held for this run's lifetime when the pin opts in.
        pin.lockName
      );
      break;
  }
}

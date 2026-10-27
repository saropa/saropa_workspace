import * as vscode from "vscode";
import * as path from "path";
import { MacroStep, Shortcut } from "../model/shortcut";
import { telemetry, RunSource } from "./telemetry";
import { runStatusRegistry } from "./runStatus";
import { playCue } from "./soundCue";
import { shortcutEvents } from "./shortcutEvents";
import { shortcutBadges, parseRunBadge } from "./shortcutBadges";
import { processRegistry } from "./processRegistry";
import * as runLock from "./runLock";

import { l10n } from "../i18n/l10n";
import { getOutputChannel, runInTerminal, createNamedTerminal } from "./terminalRunner";
import { runInBackground } from "./backgroundRunner";
import { recordLastReport } from "./lastReport";
import { openReport } from "./reportOpen";
import { runRoutine } from "./routineRunner";
import { fenceBlock, buildCommandReport, summarizeReportBody } from "./actionReport";
import { feedOfAction, formatSummaryLine, summarizeShellRun } from "../board/reportSummary";
import { firstWorkspacePath, expandRecipeTokens, reportRelativePath } from "./actionTokens";

// Re-exported so existing import paths keep working.
export { firstWorkspacePath, expandRecipeTokens, reportRelativePath } from "./actionTokens";

// Re-exported so existing import paths keep working.
export { fenceBlock, buildCommandReport, summarizeReportBody } from "./actionReport";
export type { ReportHeadline } from "./actionReport";

// The routine engine lives in routineRunner; re-exported so the runner facade and
// extension.ts keep importing the hooks from the action layer.
export { setRoutineHooks, RoutineHooks } from "./routineRunner";

// The non-file shortcut kinds (recipes): url / command / shell, plus the multi-step
// orchestrators (macro and routine). The file kind is handled by runShortcut in
// runner.ts; callers branch on the kind and route non-file shortcuts here. Split out of
// runner.ts so the file-run dispatcher stays small and these action handlers live
// with the report-capture + summary writing they share.

// Run a non-file shortcut (url / shell / command / macro). Returns without error for an
// unknown/empty action so a malformed recipe cannot throw.
export async function runAction(
  shortcut: Shortcut,
  source: RunSource = "manual"
): Promise<void> {
  const action = shortcut.action;
  if (!action) {
    return;
  }
  const name = shortcut.label ?? shortcut.id;
  // Recipe/non-file runs feed the same local telemetry as file runs.
  void telemetry.record(shortcut.id, source);
  // The shortcut's cross-process lock, passed down to the shell paths that own a child
  // process and can hold it (background / report capture). Other action kinds are
  // fire-and-forget and only the upstream runBlockReason check applies to them.
  const lockName = shortcut.lockName;

  switch (action.kind) {
    case "url":
      await openUrl(action.url, name);
      // url / command / macro shortcuts have no tracked exit; chain off their dispatch so
      // a shortcut can still be triggered "after" an open-the-dashboard or run-a-macro shortcut.
      shortcutEvents.fireComplete(shortcut.id, "dispatched");
      return;
    case "command": {
      // A recipe command that writes a report (project stats, pubspec-outdated)
      // returns the file path it wrote; capture it under this shortcut so a routine
      // summary can link the sub-report the same way the shell-report path does.
      const result = await runVsCommand(action.commandId, action.commandArgs, name);
      if (typeof result === "string" && result.length > 0) {
        recordLastReport(shortcut.id, result);
      }
      shortcutEvents.fireComplete(shortcut.id, "dispatched");
      return;
    }
    case "shell":
      // runShellAction fires its own completion: a real outcome from the background /
      // report path, or a dispatch from the terminal path. Not fired here, to avoid
      // a duplicate.
      await runShellAction(action, name, shortcut.id, lockName);
      return;
    case "macro":
      await runMacro(action.steps ?? [], name);
      shortcutEvents.fireComplete(shortcut.id, "dispatched");
      return;
    case "routine":
      // A routine resolves and runs OTHER recipe shortcuts in sequence. The resolve +
      // single-shortcut-run logic lives in the store/command layer (which this module must
      // not import — it would cycle), so it is injected once at activation via
      // setRoutineHooks. runRoutine fires its own aggregated completion.
      await runRoutine(shortcut, action.members ?? [], source);
      return;
    default:
      return;
  }
}

async function openUrl(url: string | undefined, name: string): Promise<void> {
  if (!url) {
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
  vscode.window.showInformationMessage(l10n("action.opened", { name, url }));
}

async function runVsCommand(
  commandId: string | undefined,
  args: unknown[] | undefined,
  name: string
): Promise<unknown> {
  if (!commandId) {
    return undefined;
  }
  // A command shortcut may target another extension's command (e.g. a Saropa Suite
  // recipe driving Saropa Lints / Drift Advisor / Log Capture). If that extension
  // is not installed or not yet activated, executeCommand rejects with "command
  // not found". Degrade gracefully with a visible toast instead of an unhandled
  // rejection, satisfying the suite-integration "absent tool degrades" principle.
  try {
    // The result is forwarded to the caller so a report-writing recipe command can
    // hand back the path it wrote (see the command case in runAction).
    return await vscode.commands.executeCommand(commandId, ...(args ?? []));
  } catch (err) {
    getOutputChannel().appendLine(
      `[command] ${name} (${commandId}) failed: ${err instanceof Error ? err.message : String(err)}`
    );
    vscode.window.showWarningMessage(l10n("action.commandFailed", { name }));
    // A failed command has no report path to hand back.
    return undefined;
  }
}

// Run a shell action's command line. With a reportFile, stdout+stderr are captured
// to that dated file (under cwd) and the file is opened when autoOpen is set —
// this is the scheduled-report path. Without one, output streams to the channel
// like an ordinary background run.
//
// Exported (and re-exported from runner.ts) so a caller that has a command line but no
// Shortcut — the Mobile Remote Control panel, which runs catalog data rather than stored
// shortcuts — reaches the SAME execution path (toast, cue, terminal / background,
// completion event) instead of creating a second one. Such a caller passes its own
// pseudo-id as `pinId`; that id keys the prompt memory and the completion event only, and
// resolves to no shortcut, which is why the shortcut-scoped run telemetry stays in
// runAction above rather than living here.
export async function runShellAction(
  action: { shellCommand?: string; cwd?: string; useIntegratedTerminal?: boolean; reportFile?: string; autoOpen?: boolean },
  name: string,
  pinId: string,
  lockName?: string
): Promise<void> {
  const raw = action.shellCommand;
  if (!raw) {
    return;
  }
  const cwd = expandRecipeTokens(action.cwd ?? firstWorkspacePath() ?? process.cwd());
  const commandLine = expandRecipeTokens(raw);

  if (action.reportFile) {
    await runShellToReport(
      commandLine,
      cwd,
      expandRecipeTokens(action.reportFile),
      action.autoOpen === true,
      name,
      pinId,
      lockName
    );
    return;
  }

  const useTerminal =
    action.useIntegratedTerminal ??
    vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("defaultUseIntegratedTerminal", true);
  const showToasts = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<boolean>("showRunToasts", true);
  if (showToasts) {
    vscode.window.showInformationMessage(l10n("run.starting", { name }));
  }
  // Start cue for a recipe shell run (#64). A recipe shortcut has no exec override, so it
  // follows the global cue settings; the background path below plays the finish cue.
  playCue("start");
  if (useTerminal) {
    runInTerminal(commandLine, cwd, undefined, name);
    // Terminal shell run: no tracked exit, so chain off the dispatch (background
    // fires its real outcome from settle()).
    shortcutEvents.fireComplete(pinId, "dispatched");
  } else {
    await runInBackground(
      commandLine,
      cwd,
      undefined,
      name,
      pinId,
      undefined,
      undefined,
      // A shell recipe retries by re-dispatching itself; the action carries its own
      // command/cwd, so the kill+retry path can re-run it without a file/uri.
      () => void runShellAction(action, name, pinId, lockName),
      lockName
    );
  }
}

/** What a captured-to-report run needs to write its report and record its outcome. */
interface ReportRun {
  readonly pinId: string;
  readonly name: string;
  readonly commandLine: string;
  readonly body: string;
  readonly reportPath: string;
  readonly code: number | null;
  readonly durationMs: number;
  readonly autoOpen: boolean;
}

// The summary line for a lint or test report, which the Release Board reads. Other reports
// carry none. The feed comes from the report file name, so a stored copy of the recipe works too.
export function feedSummaryLine(reportPath: string, code: number | null, body: string): string | undefined {
  const info = feedOfAction({ reportFile: reportPath });
  const summary = info ? summarizeShellRun(info.feed, code, body, Date.now()) : undefined;
  return summary ? formatSummaryLine(summary) : undefined;
}

/**
 * Writes the captured output as a report file, then records the run: last-report
 * link, status, finish cue, chain event, badge, and the optional auto-open.
 * Throws on a file error; the caller logs it.
 */
async function writeReportAndRecord(run: ReportRun): Promise<void> {
  const { pinId, name, commandLine, body, reportPath, code, durationMs, autoOpen } = run;
  const channel = getOutputChannel();
  const nodePath = await import("path");
    const fs = await import("fs/promises");
    await fs.mkdir(nodePath.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, buildCommandReport(name, commandLine, body, feedSummaryLine(reportPath, code, body)), "utf8");
    channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
    // Hand the written report path to the scheduler so a scheduled fire can
    // persist a durable "Open report" link for this shortcut (see lastReport.ts).
    recordLastReport(pinId, reportPath);
    runStatusRegistry.record(pinId, {
      outcome: code === 0 ? "success" : "failure",
      exitCode: code,
      durationMs,
      endedAt: Date.now(),
    });
    // Finish cue (#64) for a captured-to-report run (scheduled rituals, the
    // process snapshot). Report recipes carry no per-shortcut override, so they
    // follow the global cue settings.
    playCue(code === 0 ? "success" : "failure");
    // Tracked outcome for the chain engine, same as the background path.
    shortcutEvents.fireComplete(pinId, code === 0 ? "success" : "failure");
    // Badge the shortcut from the captured report body (#26, #32): the lint sweep /
    // test-trend rituals run through this report path, so this is where their
    // severity counts / test tally reach the shortcut.
    const badge = parseRunBadge(body);
    if (badge) {
      shortcutBadges.record(pinId, badge);
    }
    if (autoOpen) {
      // No-op while this run is a member of a routine — the routine opens its
      // consolidated summary instead of every member's own report.
      await openReport(reportPath);
    }
}

// Run a command, capture its combined output to a dated report file (created with
// its parent directory), and optionally open it. Used by scheduled report recipes.
async function runShellToReport(
  commandLine: string,
  cwd: string,
  reportRelOrAbs: string,
  autoOpen: boolean,
  name: string,
  pinId: string,
  lockName?: string
): Promise<void> {
  const cp = await import("child_process");
  const nodePath = await import("path");
  const channel = getOutputChannel();
  const reportPath = nodePath.isAbsolute(reportRelOrAbs)
    ? reportRelOrAbs
    : nodePath.join(cwd, reportRelOrAbs);

  channel.appendLine(`$ (${name}) ${commandLine}`);
  const startedAt = Date.now();
  let body = "";

  const child = cp.spawn(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env },
  });
  processRegistry.register(pinId, child);
  // Hold the cross-process lock for this run's lifetime (opt-in). Keyed to the
  // child PID so release() only clears OUR record, and so a crash leaves a stale
  // (dead-PID) record the next run steals rather than a permanent block.
  if (lockName && child.pid !== undefined) {
    runLock.acquire(lockName, child.pid, name);
  }
  child.stdout?.on("data", (d) => (body += d.toString()));
  child.stderr?.on("data", (d) => (body += d.toString()));

  await new Promise<void>((resolve) => {
    const finish = async (code: number | null): Promise<void> => {
      const durationMs = Date.now() - startedAt;
      // Free the cross-process lock now this run has ended (release only clears our
      // own record, so a run that already stole the lock is unaffected).
      if (lockName && child.pid !== undefined) {
        runLock.release(lockName, child.pid);
      }
      try {
        await writeReportAndRecord({ pinId, name, commandLine, body, reportPath, code, durationMs, autoOpen });
      } catch (err) {
        channel.appendLine(
          l10n("report.failed", { name, error: err instanceof Error ? err.message : String(err) })
        );
      }
      resolve();
    };
    child.on("close", (code) => void finish(code));
    child.on("error", () => void finish(null));
  });
}

// Sequentially run macro steps (open / shell / url / command). A failing step is
// logged and the macro continues, so one bad step does not abort the rest. Shell
// steps share ONE terminal for this macro's own run (created lazily on the first
// shell step, threaded through the loop) — they execute strictly in order within
// a single dispatch, so there is no cross-run collision risk; splitting them
// across separate terminals would just scatter one macro's output over N tabs.
async function runMacro(steps: MacroStep[], name: string): Promise<void> {
  const channel = getOutputChannel();
  let macroTerminal: vscode.Terminal | undefined;
  for (const [index, step] of steps.entries()) {
    try {
      macroTerminal = await runMacroStep(step, name, macroTerminal);
    } catch (err) {
      channel.appendLine(
        l10n("macro.stepFailed", {
          name,
          step: String(index + 1),
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
  vscode.window.showInformationMessage(
    l10n("macro.done", { name, count: String(steps.length) })
  );
}

async function runMacroStep(
  step: MacroStep,
  name: string,
  terminal: vscode.Terminal | undefined
): Promise<vscode.Terminal | undefined> {
  switch (step.kind) {
    case "open": {
      if (!step.path) {
        return terminal;
      }
      const uri = vscode.Uri.file(expandRecipeTokens(step.path));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      return terminal;
    }
    case "url":
      if (step.url) {
        await vscode.env.openExternal(vscode.Uri.parse(step.url));
      }
      return terminal;
    case "command":
      if (step.commandId) {
        await vscode.commands.executeCommand(
          step.commandId,
          ...(step.commandArgs ?? [])
        );
      }
      return terminal;
    case "shell": {
      if (!step.shellCommand) {
        return terminal;
      }
      const cwd = expandRecipeTokens(step.cwd ?? firstWorkspacePath() ?? process.cwd());
      const shellTerminal = terminal ?? createNamedTerminal(cwd, undefined, name);
      // Same relaunch risk as runInTerminal (terminalRunner.ts): preserving focus
      // on the tree left a stray Enter free to re-trigger the macro's shortcut.
      shellTerminal.show(false);
      shellTerminal.sendText(expandRecipeTokens(step.shellCommand));
      return shellTerminal;
    }
  }
}

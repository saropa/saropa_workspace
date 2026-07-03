import * as vscode from "vscode";
import * as path from "path";
import { MacroStep, Shortcut, RoutineMember } from "../model/shortcut";
import { telemetry, RunSource } from "./telemetry";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { playCue } from "./soundCue";
import { shortcutEvents } from "./shortcutEvents";
import { ShortcutBadge, shortcutBadges, parseRunBadge } from "./shortcutBadges";
import { processRegistry } from "./processRegistry";
import * as runLock from "./runLock";
import { hasInteractiveTokens } from "./promptTokens";
import { l10n } from "../i18n/l10n";
import { getOutputChannel, runInTerminal } from "./terminalRunner";
import { runInBackground } from "./backgroundRunner";
import { recordLastReport } from "./lastReport";

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
    case "command":
      await runVsCommand(action.commandId, action.commandArgs, name);
      shortcutEvents.fireComplete(shortcut.id, "dispatched");
      return;
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
): Promise<void> {
  if (!commandId) {
    return;
  }
  // A command shortcut may target another extension's command (e.g. a Saropa Suite
  // recipe driving Saropa Lints / Drift Advisor / Log Capture). If that extension
  // is not installed or not yet activated, executeCommand rejects with "command
  // not found". Degrade gracefully with a visible toast instead of an unhandled
  // rejection, satisfying the suite-integration "absent tool degrades" principle.
  try {
    await vscode.commands.executeCommand(commandId, ...(args ?? []));
  } catch (err) {
    getOutputChannel().appendLine(
      `[command] ${name} (${commandId}) failed: ${err instanceof Error ? err.message : String(err)}`
    );
    vscode.window.showWarningMessage(l10n("action.commandFailed", { name }));
  }
}

// Run a shell action's command line. With a reportFile, stdout+stderr are captured
// to that dated file (under cwd) and the file is opened when autoOpen is set —
// this is the scheduled-report path. Without one, output streams to the channel
// like an ordinary background run.
async function runShellAction(
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
  vscode.window.showInformationMessage(l10n("run.starting", { name }));
  // Start cue for a recipe shell run (#64). A recipe shortcut has no exec override, so it
  // follows the global cue settings; the background path below plays the finish cue.
  playCue("start");
  if (useTerminal) {
    runInTerminal(commandLine, cwd, undefined);
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
  const header = `# ${name}\n\nGenerated ${new Date().toLocaleString()}\nCommand: ${commandLine}\n\n`;
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
        const fs = await import("fs/promises");
        await fs.mkdir(nodePath.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, header + body, "utf8");
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
          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(reportPath)
          );
          await vscode.window.showTextDocument(doc, { preview: false });
        }
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
// logged and the macro continues, so one bad step does not abort the rest.
async function runMacro(steps: MacroStep[], name: string): Promise<void> {
  const channel = getOutputChannel();
  for (const [index, step] of steps.entries()) {
    try {
      await runMacroStep(step);
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

async function runMacroStep(step: MacroStep): Promise<void> {
  switch (step.kind) {
    case "open": {
      if (!step.path) {
        return;
      }
      const uri = vscode.Uri.file(expandRecipeTokens(step.path));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }
    case "url":
      if (step.url) {
        await vscode.env.openExternal(vscode.Uri.parse(step.url));
      }
      return;
    case "command":
      if (step.commandId) {
        await vscode.commands.executeCommand(
          step.commandId,
          ...(step.commandArgs ?? [])
        );
      }
      return;
    case "shell": {
      if (!step.shellCommand) {
        return;
      }
      const cwd = expandRecipeTokens(step.cwd ?? firstWorkspacePath() ?? process.cwd());
      runInTerminal(expandRecipeTokens(step.shellCommand), cwd, undefined);
      return;
    }
  }
}

import { runRoutine } from "./routineRunner";

// The routine engine lives in routineRunner; re-exported so the runner facade and
// extension.ts keep importing the hooks from the action layer.
export { setRoutineHooks, RoutineHooks } from "./routineRunner";


export function firstWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Expand recipe-time tokens that are not file-scoped: $workspaceRoot, plus the
// date stamps used by report paths. $stamp is filesystem-safe (YYYY.MM.DD_HHmmss)
// for report file names; $date is YYYY-MM-DD for headings; $datedir is the dotted
// calendar date (YYYY.MM.DD) used as a per-day report folder; $time is HHmmss.
// Exported so the dry-run audit (simulateRun) resolves a recipe's shell/cwd the same
// way an actual run does, from this single source of truth rather than a second copy.
export function expandRecipeTokens(value: string): string {
  const root = firstWorkspacePath() ?? "";
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const datedir = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const stamp = `${datedir}_${time}`;
  // $datedir must be replaced before $date — "$date" is a prefix of "$datedir", so the
  // narrower token would otherwise consume the "$date" inside "$datedir".
  return value
    .split("$workspaceRoot").join(root)
    .split("$datedir").join(datedir)
    .split("$stamp").join(stamp)
    .split("$date").join(date)
    .split("$time").join(time);
}

// The per-day report folder and the report file's name prefix. "workspace" tags
// these as Saropa Workspace's own reports — identifiable when several Suite tools
// share one reports/ folder — and sits right after the calendar date in both the
// folder name and the file name. $datedir/$time expand at run time.
const REPORT_DAY = "$datedir_workspace";

// Build a dated report's path relative to the workspace root, from a single
// definition so every recipe and in-process report writer agrees on the layout:
//   reports/<date>_workspace/<date>_workspace_<time>_<suffix>.<ext>
// e.g. reports/2026.06.29_workspace/2026.06.29_workspace_100046_standup.md
export function reportRelativePath(suffix: string, ext = "md"): string {
  return `reports/${REPORT_DAY}/${REPORT_DAY}_$time_${suffix}.${ext}`;
}

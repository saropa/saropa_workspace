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
import { getOutputChannel, runInTerminal, createNamedTerminal } from "./terminalRunner";
import { runInBackground } from "./backgroundRunner";
import { recordLastReport } from "./lastReport";
import { openReport } from "./reportOpen";

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

// Wrap raw command output in a Markdown fenced code block so a Markdown preview
// renders it as monospace preformatted text instead of mangling it as prose — a
// `git log --stat` / `git status` dump read as Markdown is the "unreadable slop"
// the report bug called out. The fence length is one backtick longer than the
// longest backtick run in the body, so output that itself contains a ``` fence
// (rare, but e.g. a grep over Markdown) can never break out of the block.
// Exported: routineRunner reuses this to fence a non-Markdown member report when
// merging it into the routine summary (single source for the widened-fence rule).
export function fenceBlock(body: string): string {
  const runs = body.match(/`+/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${body.replace(/\n+$/, "")}\n${fence}`;
}

// Build a captured-command report as clean Markdown: an H1 heading, a metadata
// block (generation time + the exact command, code-formatted so it is copy-paste
// safe), and the command's combined output fenced as a code block. An empty result
// is stated plainly rather than left as a blank fence, so "no output" reads as a
// deliberate outcome. Single source for every scheduled shell ritual's report shape.
// Exported for the unit test (report-bug items 1 and 2: no more unfenced slop).
export function buildCommandReport(name: string, commandLine: string, body: string): string {
  const trimmed = body.trim();
  const output = trimmed.length > 0 ? fenceBlock(body) : "_No output._";
  const headline = summarizeReportBody(trimmed);
  // Two conventions, not one: **Attention:** marks a finding that needs the reader to
  // DO something, **Headline:** one that merely informs. The routine summary sorts on
  // this to decide its verdict, so the distinction has to be made by whoever
  // understands the output — the summarizer — not guessed at later from wording.
  const label = headline?.attention ? "Attention" : "Headline";
  return (
    `# ${name}\n\n` +
    `**Generated** ${new Date().toLocaleString()}\n\n` +
    (headline ? `**${label}:** ${headline.text}\n\n` : "") +
    `**Command** \`${commandLine}\`\n\n` +
    `${output}\n`
  );
}

// A report's one-line finding, and whether it is something to act on.
export interface ReportHeadline {
  text: string;
  attention: boolean;
}

// One line stating what the captured output amounts to, or undefined when the output
// has no shape worth summarizing (a headline of "412 lines" is noise, not a headline).
// Keyed off the OUTPUT, never the command line: the same digest is reachable through a
// hand-written shortcut, and a command-string match would silently stop working the
// first time a flag order changed.
export function summarizeReportBody(body: string): ReportHeadline | undefined {
  if (body.length === 0) {
    return { text: "Nothing to report.", attention: false };
  }
  const lines = body.split("\n");

  // `gh run list` — tab-separated, leading with the run's status and conclusion.
  // Checked before the commit shape because a run row also carries a commit sha.
  const runs = lines.filter((l) => /^(completed|in_progress|queued|requested)\t/.test(l));
  if (runs.length > 0) {
    // `cancell?ed` matches either spelling: the GitHub API's conclusion value carries
    // the double-l form, which this repo's American-English rule forbids writing out.
    const failed = runs.filter((l) => /^completed\t(failure|timed_out|cancell?ed)\t/.test(l));
    if (failed.length > 0) {
      // Name the workflow of the newest failure: "2 runs failing" sends the reader
      // hunting, "2 runs failing (build)" tells them where to look.
      const workflow = failed[0]?.split("\t")[4]?.trim();
      return {
        text: `${failed.length} of the last ${runs.length} CI runs failing${workflow ? ` (${workflow})` : ""}`,
        attention: true,
      };
    }
    const running = runs.filter((l) => !l.startsWith("completed\t")).length;
    return {
      text: running > 0 ? `CI green, ${running} still running` : "CI green",
      attention: false,
    };
  }

  // `<sha> <subject>` — the shape of --oneline / --pretty=format:"%h %s".
  const commits = lines.filter((l) => /^[0-9a-f]{7,40} \S/.test(l)).length;
  if (commits > 0) {
    const totals = sumShortstat(lines);
    const parts = [`${commits} commit${commits === 1 ? "" : "s"}`];
    if (totals) {
      parts.push(
        `${totals.files} file${totals.files === 1 ? "" : "s"} changed`,
        `+${totals.insertions.toLocaleString()} / -${totals.deletions.toLocaleString()}`
      );
    }
    // History is a record, not a task: it informs, it does not ask for anything.
    return { text: parts.join(" · "), attention: false };
  }

  // `XY path` — git status --porcelain, the shape the uncommitted-work guard captures.
  const dirty = lines.filter((l) => /^[ MADRCU?!]{2} \S/.test(l)).length;
  if (dirty > 0) {
    // Work left outside a commit is the one finding here that can be lost, so it
    // asks for action rather than merely reporting a count.
    return {
      text: `${dirty} uncommitted file${dirty === 1 ? "" : "s"}`,
      attention: true,
    };
  }
  return undefined;
}

// Total the `N files changed, N insertions(+), N deletions(-)` lines --shortstat emits
// after each commit. Any of the three clauses may be absent (a commit that only added
// files has no deletions clause), so each is matched independently.
function sumShortstat(lines: readonly string[]):
  | { files: number; insertions: number; deletions: number }
  | undefined {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  let seen = false;
  for (const line of lines) {
    if (!/^\s*\d+ files? changed/.test(line)) {
      continue;
    }
    seen = true;
    files += Number(/(\d+) files? changed/.exec(line)?.[1] ?? 0);
    insertions += Number(/(\d+) insertions?\(\+\)/.exec(line)?.[1] ?? 0);
    deletions += Number(/(\d+) deletions?\(-\)/.exec(line)?.[1] ?? 0);
  }
  return seen ? { files, insertions, deletions } : undefined;
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
        const fs = await import("fs/promises");
        await fs.mkdir(nodePath.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, buildCommandReport(name, commandLine, body), "utf8");
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
      shellTerminal.show(true);
      shellTerminal.sendText(expandRecipeTokens(step.shellCommand));
      return shellTerminal;
    }
  }
}

import { runRoutine } from "./routineRunner";

// The routine engine lives in routineRunner; re-exported so the runner facade and
// extension.ts keep importing the hooks from the action layer.
export { setRoutineHooks, RoutineHooks } from "./routineRunner";


// The primary workspace folder's absolute path, or undefined with no folder open. The
// cwd fallback for a shell/macro action that carries no explicit cwd of its own.
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

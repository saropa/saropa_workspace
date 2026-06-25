import * as vscode from "vscode";
import * as path from "path";
import { MacroStep, Pin } from "../model/pin";
import { processRegistry } from "./processRegistry";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { recentRuns } from "./recentRuns";
import { buildTokenMap, expandTokens } from "./tokens";
import {
  hasInteractiveTokens,
  resolveInteractiveTokens,
  cloneWithResolvedTokens,
} from "./promptTokens";
import { l10n } from "../i18n/l10n";

// Builds and launches the command for a pin. Phase 1 supports the integrated
// terminal (visible, interactive) and a background output channel.

let sharedTerminal: vscode.Terminal | undefined;
let outputChannel: vscode.OutputChannel | undefined;

// Reset the cached terminal handle when the user closes it, so the next run
// recreates one instead of writing to a disposed terminal.
export function registerTerminalCleanup(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === sharedTerminal) {
        sharedTerminal = undefined;
      }
    })
  );
}

// Resolve the command prefix for a file: explicit per-pin command wins, else the
// configured default for the file extension. Empty result means "run directly".
function resolveCommandPrefix(pin: Pin, fsPath: string): string {
  if (pin.exec?.command !== undefined) {
    return pin.exec.command;
  }
  const ext = path.extname(fsPath).toLowerCase();
  const defaults = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<Record<string, string>>("interpreterDefaults", {});
  return defaults[ext] ?? "";
}

// Whether running this pin makes sense, i.e. there is a way to execute it. True
// when the user set an explicit command (including an explicit empty string,
// which means "run the file directly" — e.g. a shebang script), or the file's
// extension has a configured default interpreter. False for an ordinary document
// (a .txt, .md, image, etc.) with no interpreter, where "run" has no meaning and
// the caller should open the file instead of throwing it at the shell.
export function isRunnable(pin: Pin, fsPath: string): boolean {
  if (pin.exec?.command !== undefined) {
    return true;
  }
  const ext = path.extname(fsPath).toLowerCase();
  const defaults = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<Record<string, string>>("interpreterDefaults", {});
  return defaults[ext] !== undefined;
}

// Quote a path/arg for the shell. Simple double-quote wrapping covers the common
// case (paths with spaces) without a full shell-escaping dependency.
function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

// Everything needed to launch a pin, resolved from its config and target. Kept
// as a single value so the scheduler can log the exact command it is about to
// run from one source of truth (planRun), rather than reassembling it.
export interface RunPlan {
  commandLine: string;
  cwd: string;
  env: Record<string, string> | undefined;
  name: string;
  useTerminal: boolean;
  // $names that appeared in the command/args/cwd but are not recognized tokens.
  // Left literal in the command; surfaced once by runPin so they are not blanked
  // silently (a literal $name may also be an intentional shell variable).
  unknownTokens: string[];
}

// Resolve a pin + target into a concrete RunPlan. Pure of side effects so both
// runPin and the scheduler's log line share one assembly path.
export function planRun(pin: Pin, uri: vscode.Uri): RunPlan {
  const fsPath = uri.fsPath;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;

  // Expand placeholder tokens in the command, each arg, and a custom cwd before
  // assembly/quoting, so a substituted path with spaces is quoted as one arg.
  const tokens = buildTokenMap(fsPath, workspaceRoot);
  const unknown = new Set<string>();

  const prefix = expandTokens(resolveCommandPrefix(pin, fsPath), tokens, unknown);
  const args = (pin.exec?.args ?? []).map((a) => expandTokens(a, tokens, unknown));
  const cwd = pin.exec?.cwd
    ? expandTokens(pin.exec.cwd, tokens, unknown)
    : workspaceRoot ?? path.dirname(fsPath);

  const name = pin.label ?? path.basename(fsPath);

  // Assemble: <prefix> "<file>" <args...>. A blank prefix runs the file directly.
  // includeFilePath === false omits the file entirely (npm-script / Make-target
  // run configs name their work in args and run against cwd, not the file path).
  const includeFile = pin.exec?.includeFilePath !== false;
  const parts = [
    prefix,
    ...(includeFile ? [quote(fsPath)] : []),
    ...args.map(quote),
  ].filter((p) => p.length > 0);
  const commandLine = parts.join(" ");

  const useTerminal =
    pin.exec?.useIntegratedTerminal ??
    vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("defaultUseIntegratedTerminal", true);

  return {
    commandLine,
    cwd,
    env: pin.exec?.env,
    name,
    useTerminal,
    unknownTokens: [...unknown],
  };
}

// Lazily create (and reuse) the shared output channel. Shared so scheduled-run
// log lines and background-run output land in the same "Saropa Workspace" panel.
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Saropa Workspace");
  }
  return outputChannel;
}

export async function runPin(pin: Pin, uri: vscode.Uri): Promise<void> {
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

  const plan = planRun(effectivePin, uri);

  // Note unrecognized $tokens once so they are visibly left literal rather than
  // silently dropped (acceptance 2.4).
  if (plan.unknownTokens.length > 0) {
    getOutputChannel().appendLine(
      l10n("run.unknownTokens", {
        tokens: plan.unknownTokens.map((t) => `$${t}`).join(", "),
      })
    );
  }

  // Record the run for the "Run Pin..." palette's recents (after the cancel
  // checks above, so an aborted interactive prompt does not count as a run).
  void recentRuns.record(pin.id);

  vscode.window.showInformationMessage(l10n("run.starting", { name: plan.name }));

  if (plan.useTerminal) {
    runInTerminal(plan.commandLine, plan.cwd, plan.env);
  } else {
    await runInBackground(plan.commandLine, plan.cwd, plan.env, plan.name, pin.id);
  }
}

// --- non-file pin kinds (recipes) --------------------------------------

// Run a non-file pin (url / shell / command / macro). The file kind is handled by
// runPin above; callers branch on pinKind and route non-file pins here. Returns
// without error for an unknown/empty action so a malformed recipe cannot throw.
export async function runAction(pin: Pin): Promise<void> {
  const action = pin.action;
  if (!action) {
    return;
  }
  const name = pin.label ?? pin.id;
  // Recipe/non-file runs feed the same recents list as file runs.
  void recentRuns.record(pin.id);

  switch (action.kind) {
    case "url":
      await openUrl(action.url, name);
      return;
    case "command":
      await runVsCommand(action.commandId, action.commandArgs, name);
      return;
    case "shell":
      await runShellAction(action, name, pin.id);
      return;
    case "macro":
      await runMacro(action.steps ?? [], name);
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
  await vscode.commands.executeCommand(commandId, ...(args ?? []));
}

// Run a shell action's command line. With a reportFile, stdout+stderr are captured
// to that dated file (under cwd) and the file is opened when autoOpen is set —
// this is the scheduled-report path. Without one, output streams to the channel
// like an ordinary background run.
async function runShellAction(
  action: { shellCommand?: string; cwd?: string; useIntegratedTerminal?: boolean; reportFile?: string; autoOpen?: boolean },
  name: string,
  pinId: string
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
      pinId
    );
    return;
  }

  const useTerminal =
    action.useIntegratedTerminal ??
    vscode.workspace
      .getConfiguration("saropaWorkspace")
      .get<boolean>("defaultUseIntegratedTerminal", true);
  vscode.window.showInformationMessage(l10n("run.starting", { name }));
  if (useTerminal) {
    runInTerminal(commandLine, cwd, undefined);
  } else {
    await runInBackground(commandLine, cwd, undefined, name, pinId);
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
  pinId: string
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
  child.stdout?.on("data", (d) => (body += d.toString()));
  child.stderr?.on("data", (d) => (body += d.toString()));

  await new Promise<void>((resolve) => {
    const finish = async (code: number | null): Promise<void> => {
      const durationMs = Date.now() - startedAt;
      try {
        const fs = await import("fs/promises");
        await fs.mkdir(nodePath.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, header + body, "utf8");
        channel.appendLine(l10n("report.wrote", { name, path: reportPath }));
        runStatusRegistry.record(pinId, {
          outcome: code === 0 ? "success" : "failure",
          exitCode: code,
          durationMs,
          endedAt: Date.now(),
        });
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

function firstWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Expand recipe-time tokens that are not file-scoped: $workspaceRoot, plus the
// date stamps used by report paths. $stamp is filesystem-safe (YYYY.MM.DD_HHmmss)
// for report file names; $date is YYYY-MM-DD for headings.
function expandRecipeTokens(value: string): string {
  const root = firstWorkspacePath() ?? "";
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const stamp = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(
    now.getDate()
  )}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return value
    .split("$workspaceRoot").join(root)
    .split("$stamp").join(stamp)
    .split("$date").join(date);
}

function runInTerminal(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined
): void {
  const terminalName = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<string>("terminalName", "Saropa Workspace");

  if (!sharedTerminal) {
    sharedTerminal = vscode.window.createTerminal({ name: terminalName, env });
  }
  sharedTerminal.show(true);
  // cd first so relative args/cwd behave; quoting handles spaces in the path.
  sharedTerminal.sendText(`cd ${quote(cwd)}`);
  sharedTerminal.sendText(commandLine);
}

async function runInBackground(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  name: string,
  pinId: string
): Promise<void> {
  const cp = await import("child_process");
  const channel = getOutputChannel();
  channel.appendLine(`$ (${name}) ${commandLine}`);
  channel.show(true);

  const startedAt = Date.now();
  const child = cp.spawn(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env, ...(env ?? {}) },
  });
  // Track the child so the tree can show it running and a Stop action can kill
  // it; the registry clears itself on exit.
  processRegistry.register(pinId, child);
  child.stdout?.on("data", (d) => channel.append(d.toString()));
  child.stderr?.on("data", (d) => channel.append(d.toString()));

  // Node may emit BOTH "error" (spawn failed) and "close" for the same failed
  // run; settle once so the result is recorded and the toast shown a single time.
  let settled = false;
  const settle = (outcome: "success" | "failure", code: number | null): void => {
    if (settled) {
      return;
    }
    settled = true;
    const durationMs = Date.now() - startedAt;
    runStatusRegistry.record(pinId, {
      outcome,
      exitCode: code,
      durationMs,
      endedAt: Date.now(),
    });
    notifyCompletion(name, outcome, code, durationMs);
  };

  // On exit, record the result so the tree shows a success/failure badge (7.2)
  // and surface the outcome: a failure is loud (error toast + one-click output),
  // a success is a quiet confirmation. Code 0 is success; any other code, or a
  // null code (killed by signal / stop), is a failure.
  child.on("close", (code) => {
    channel.appendLine(
      `\n[${name}] exited with code ${code} (${formatDuration(
        Date.now() - startedAt
      )})`
    );
    settle(code === 0 ? "success" : "failure", code);
  });

  // A spawn failure (command not found, cwd missing) may not emit "close"; record
  // it so the tree does not sit on a stale "running" forever.
  child.on("error", (err) => {
    channel.appendLine(`\n[${name}] failed to start: ${err.message}`);
    settle("failure", null);
  });
}

// Visible outcome for a finished background run. Failures get an error toast with
// a one-click path to the output channel; successes get a quiet info toast. Never
// silent — completion is feedback the user is waiting on.
function notifyCompletion(
  name: string,
  outcome: "success" | "failure",
  code: number | null,
  durationMs: number
): void {
  const duration = formatDuration(durationMs);
  if (outcome === "success") {
    vscode.window.showInformationMessage(l10n("run.succeeded", { name, duration }));
    return;
  }
  const showOutput = l10n("run.showOutput");
  void vscode.window
    .showErrorMessage(
      l10n("run.failed", { name, code: code === null ? "?" : code, duration }),
      showOutput
    )
    .then((choice) => {
      if (choice === showOutput) {
        getOutputChannel().show(true);
      }
    });
}

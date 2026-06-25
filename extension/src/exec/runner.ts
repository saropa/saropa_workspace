import * as vscode from "vscode";
import * as path from "path";
import { Pin } from "../model/pin";
import { processRegistry } from "./processRegistry";
import { runStatusRegistry, formatDuration } from "./runStatus";
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
  const parts = [prefix, quote(fsPath), ...args.map(quote)].filter(
    (p) => p.length > 0
  );
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

  vscode.window.showInformationMessage(l10n("run.starting", { name: plan.name }));

  if (plan.useTerminal) {
    runInTerminal(plan.commandLine, plan.cwd, plan.env);
  } else {
    await runInBackground(plan.commandLine, plan.cwd, plan.env, plan.name, pin.id);
  }
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

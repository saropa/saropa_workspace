import * as vscode from "vscode";
import * as path from "path";
import { Pin } from "../model/pin";
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
}

// Resolve a pin + target into a concrete RunPlan. Pure of side effects so both
// runPin and the scheduler's log line share one assembly path.
export function planRun(pin: Pin, uri: vscode.Uri): RunPlan {
  const fsPath = uri.fsPath;
  const prefix = resolveCommandPrefix(pin, fsPath);
  const args = pin.exec?.args ?? [];
  const cwd =
    pin.exec?.cwd ??
    vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ??
    path.dirname(fsPath);

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

  return { commandLine, cwd, env: pin.exec?.env, name, useTerminal };
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
  const plan = planRun(pin, uri);

  vscode.window.showInformationMessage(l10n("run.starting", { name: plan.name }));

  if (plan.useTerminal) {
    runInTerminal(plan.commandLine, plan.cwd, plan.env);
  } else {
    await runInBackground(plan.commandLine, plan.cwd, plan.env, plan.name);
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
  name: string
): Promise<void> {
  const cp = await import("child_process");
  const channel = getOutputChannel();
  channel.appendLine(`$ (${name}) ${commandLine}`);
  channel.show(true);

  const child = cp.spawn(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env, ...(env ?? {}) },
  });
  child.stdout?.on("data", (d) => channel.append(d.toString()));
  child.stderr?.on("data", (d) => channel.append(d.toString()));
  child.on("close", (code) =>
    channel.appendLine(`\n[${name}] exited with code ${code}`)
  );
}

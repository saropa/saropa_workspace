import * as vscode from "vscode";
import { quoteArg } from "./commandPlan";

// The two shared VS Code singletons every run path writes to: the "Saropa Workspace"
// output channel and the reused integrated terminal. Kept in this leaf module (no
// imports from the other runner files) so the planning / background / external /
// action modules can all reach them without an import cycle through runner.ts.

let sharedTerminal: vscode.Terminal | undefined;
let outputChannel: vscode.OutputChannel | undefined;

// Lazily create (and reuse) the shared output channel. Shared so scheduled-run
// log lines and background-run output land in the same "Saropa Workspace" panel.
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Saropa Workspace");
  }
  return outputChannel;
}

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

export function runInTerminal(
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
  sharedTerminal.sendText(`cd ${quoteArg(cwd)}`);
  sharedTerminal.sendText(commandLine);
}

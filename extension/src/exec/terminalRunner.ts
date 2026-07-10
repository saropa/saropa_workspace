import * as vscode from "vscode";

// The shared "Saropa Workspace" output channel every run path writes to. Kept in
// this leaf module (no imports from the other runner files) so the planning /
// background / external / action modules can all reach it without an import
// cycle through runner.ts.

let outputChannel: vscode.OutputChannel | undefined;

// Lazily create (and reuse) the shared output channel. Shared so scheduled-run
// log lines and background-run output land in the same "Saropa Workspace" panel.
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Saropa Workspace");
  }
  return outputChannel;
}

// Create a fresh integrated terminal rooted at cwd (so no `cd` is ever needed),
// labeled with the shortcut's name. Exported (not just used by runInTerminal
// below) so a caller that legitimately needs to send SEVERAL commands to the
// SAME terminal in sequence — a macro's shell steps, which run one after another
// within a single dispatch — can create one terminal and reuse it for its own
// steps, without reintroducing a terminal shared ACROSS unrelated runs.
export function createNamedTerminal(
  cwd: string,
  env: Record<string, string> | undefined,
  label?: string
): vscode.Terminal {
  const terminalName = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<string>("terminalName", "Saropa Workspace");
  const displayName = label ? `${terminalName}: ${label}` : terminalName;
  return vscode.window.createTerminal({ name: displayName, env, cwd });
}

// Launch a run in a brand-new integrated terminal. A single shared/reused
// terminal meant a second shortcut launched while an earlier one was still busy
// (a long-running process, a prompt waiting on stdin) sent its command line into
// that busy terminal instead of a new one — reading as "pasted into the wrong
// window". Every run — including a repeat run of the same shortcut — now gets
// its own tab, so concurrent runs can never collide.
export function runInTerminal(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  label?: string
): void {
  const terminal = createNamedTerminal(cwd, env, label);
  terminal.show(true);
  terminal.sendText(commandLine);
}

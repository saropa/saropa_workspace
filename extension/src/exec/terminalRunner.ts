import * as vscode from "vscode";
import * as path from "path";
import { quoteArg } from "./commandPlan";

// The two shared VS Code singletons every run path writes to: the "Saropa Workspace"
// output channel and the reused integrated terminal. Kept in this leaf module (no
// imports from the other runner files) so the planning / background / external /
// action modules can all reach them without an import cycle through runner.ts.

let sharedTerminal: vscode.Terminal | undefined;
// The directory the shared terminal is known to sit in: the cwd we created it with,
// or the last cwd we cd'd it to. Used to skip a redundant `cd` when the next run
// targets the same directory. undefined means unknown (terminal not yet created).
let sharedTerminalCwd: string | undefined;
let outputChannel: vscode.OutputChannel | undefined;

// Compare two directory paths for "the terminal is already here". Normalizes
// separators, a trailing separator, and (on Windows's case-insensitive filesystem)
// case — otherwise `D:\src` vs `d:\src\` would force a needless cd.
export function sameDirectory(a: string, b: string): boolean {
  const normalize = (p: string): string => {
    // path.normalize keeps a trailing separator, so strip it (but not a bare root
    // like `C:\` or `/`) before comparing; lowercase only where the FS ignores case.
    const normalized = path.normalize(p).replace(/[\\/]+$/, "") || p;
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(a) === normalize(b);
}

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
        sharedTerminalCwd = undefined;
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
    // Create the terminal already rooted at cwd so the first run needs no cd; the
    // shell starts in the target directory.
    sharedTerminal = vscode.window.createTerminal({ name: terminalName, env, cwd });
    sharedTerminalCwd = cwd;
  }
  sharedTerminal.show(true);
  // Only cd when the terminal is not already in the target directory — skips a
  // redundant `cd` when consecutive runs share a cwd (e.g. running several
  // scripts from the same project root). Quoting handles spaces in the path.
  if (sharedTerminalCwd === undefined || !sameDirectory(sharedTerminalCwd, cwd)) {
    sharedTerminal.sendText(`cd ${quoteArg(cwd)}`);
    sharedTerminalCwd = cwd;
  }
  sharedTerminal.sendText(commandLine);
}

import * as vscode from "vscode";
import * as path from "path";
import { quoteArg } from "./commandPlan";

// The two shared VS Code singletons every run path writes to: the "Saropa Workspace"
// output channel and the reused integrated terminal. Kept in this leaf module (no
// imports from the other runner files) so the planning / background / external /
// action modules can all reach them without an import cycle through runner.ts.

// One terminal per key (normally a shortcut's id) rather than a single shared
// terminal for every run. A single shared terminal meant a second shortcut
// launched while the first was still busy (a long-running process, a REPL
// waiting on stdin) sent its command line into that same busy terminal instead
// of opening its own — reading as "pasted into the wrong window". Keying by
// shortcut still reuses one tab across repeat runs of the SAME shortcut (so the
// `cd` skip below still applies), it just stops different shortcuts from
// sharing one.
const terminals = new Map<string, vscode.Terminal>();
// The directory each keyed terminal is known to sit in: the cwd it was created
// with, or the last cwd it was cd'd to. Used to skip a redundant `cd` when the
// next run on that terminal targets the same directory.
const terminalCwds = new Map<string, string>();
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

// Reset a keyed terminal's cached handle when the user closes it, so the next
// run for that key recreates one instead of writing to a disposed terminal.
export function registerTerminalCleanup(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      for (const [key, terminal] of terminals) {
        if (terminal === t) {
          terminals.delete(key);
          terminalCwds.delete(key);
          break;
        }
      }
    })
  );
}

// Send a run to its keyed terminal: create it (rooted at cwd) on first use, reuse
// it otherwise, cd only when the target directory differs from where the
// terminal already sits, then send the command line. `key` isolates unrelated
// runs (normally the shortcut's id) so one busy terminal never receives another
// shortcut's command; omit it only for genuinely one-off ad hoc commands.
export function runInTerminal(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  key = "default",
  label?: string
): void {
  const terminalName = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<string>("terminalName", "Saropa Workspace");
  const displayName = label ? `${terminalName}: ${label}` : terminalName;

  let terminal = terminals.get(key);
  if (!terminal) {
    // Create the terminal already rooted at cwd so the first run needs no cd; the
    // shell starts in the target directory.
    terminal = vscode.window.createTerminal({ name: displayName, env, cwd });
    terminals.set(key, terminal);
    terminalCwds.set(key, cwd);
  }
  terminal.show(true);
  // Only cd when the terminal is not already in the target directory — skips a
  // redundant `cd` when consecutive runs of the same shortcut share a cwd.
  // Quoting handles spaces in the path.
  const knownCwd = terminalCwds.get(key);
  if (knownCwd === undefined || !sameDirectory(knownCwd, cwd)) {
    terminal.sendText(`cd ${quoteArg(cwd)}`);
    terminalCwds.set(key, cwd);
  }
  terminal.sendText(commandLine);
}

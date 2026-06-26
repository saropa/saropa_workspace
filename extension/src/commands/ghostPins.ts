import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PinStore } from "../model/pinStore";
import { l10n } from "../i18n/l10n";

// Candidate shell-history files across the common shells (WOW #2). Each is read if
// present; a machine typically has one. PSReadLine is the Windows PowerShell
// default; bash/zsh cover macOS and Linux. History is only ever READ — never
// modified — and nothing leaves the machine.
function historyFiles(): string[] {
  const home = os.homedir();
  const files: string[] = [];
  const appData = process.env.APPDATA;
  if (appData) {
    files.push(
      path.join(
        appData,
        "Microsoft",
        "Windows",
        "PowerShell",
        "PSReadLine",
        "ConsoleHost_history.txt"
      )
    );
  }
  files.push(path.join(home, ".bash_history"));
  files.push(path.join(home, ".zsh_history"));
  return files;
}

// Reduce a raw history line to the bare command. zsh extended history prefixes each
// line with ": <epoch>:<elapsed>;" — strip it; bash and PSReadLine store the plain
// command and pass through unchanged.
function normalizeHistoryLine(raw: string): string {
  const zshMatch = /^:\s*\d+:\d+;(.*)$/.exec(raw);
  return (zshMatch ? zshMatch[1] : raw).trim();
}

// Bare navigation/util commands that are never worth pinning even when frequent.
const TRIVIAL_HEADS = new Set([
  "ls", "ll", "la", "cd", "pwd", "clear", "cls", "exit", "q", "code",
]);

// A command worth suggesting: it takes arguments (has a space) and is long enough
// to be a real one-liner rather than a bare builtin, and its leading command is not
// trivial navigation. The point is to resurface the docker / psql / ssh / curl
// invocations a developer retypes, not "ls" or "git status".
function isWorthSuggesting(command: string): boolean {
  if (command.length < 12 || !command.includes(" ")) {
    return false;
  }
  const head = command.split(/\s+/)[0];
  return !TRIVIAL_HEADS.has(head);
}

interface FrequentCommand {
  command: string;
  count: number;
}

// Read every available history file and tally how often each worth-suggesting
// command appears, keeping those at or above minCount. A file that does not exist
// or cannot be read is skipped silently — a missing shell history is normal, not an
// error. Returns the most-frequent commands first, capped at max.
async function frequentCommands(
  minCount: number,
  max: number
): Promise<FrequentCommand[]> {
  const counts = new Map<string, number>();
  for (const file of historyFiles()) {
    let text: string;
    try {
      text = await fs.promises.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const command = normalizeHistoryLine(rawLine);
      if (isWorthSuggesting(command)) {
        counts.set(command, (counts.get(command) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([command, count]) => ({ command, count }))
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

// Suggest pins from frequently-typed shell commands (WOW #2): scan local shell
// history for complex commands typed at least a few times and offer to save the
// ones the user picks as global shell pins. Read-only until the user explicitly
// selects — nothing is pinned or run automatically, and the history is never
// transmitted or modified.
export async function suggestFromHistory(store: PinStore): Promise<void> {
  const MIN_COUNT = 3;
  const MAX_SUGGESTIONS = 20;
  const LABEL_MAX = 50;
  const frequent = await frequentCommands(MIN_COUNT, MAX_SUGGESTIONS);
  if (frequent.length === 0) {
    vscode.window.showInformationMessage(l10n("ghost.none", { count: MIN_COUNT }));
    return;
  }
  const items = frequent.map((entry) => ({
    label: entry.command,
    description: l10n("ghost.ranCount", { count: entry.count }),
    iconPath: new vscode.ThemeIcon("terminal"),
    command: entry.command,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: l10n("ghost.placeholder"),
    canPickMany: true,
    matchOnDescription: true,
  });
  if (!picked || picked.length === 0) {
    return;
  }
  let added = 0;
  for (const item of picked) {
    // A long command is unreadable as a tree-row name; truncate the label while the
    // pin keeps the full command (shown as the row detail and run verbatim).
    const label =
      item.command.length > LABEL_MAX
        ? `${item.command.slice(0, LABEL_MAX - 1)}…`
        : item.command;
    // Global scope: a frequently-typed command is a personal, machine-wide habit,
    // not a repo artifact, and a shell pin carries no path that would tie it to one
    // folder. Run in the integrated terminal so its output is visible.
    const ok = await store.addShellPin(label, item.command, "global", true);
    if (ok) {
      added++;
    }
  }
  vscode.window.showInformationMessage(l10n("ghost.added", { count: added }));
}

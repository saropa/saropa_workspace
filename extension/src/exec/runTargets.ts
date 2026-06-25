import * as vscode from "vscode";
import * as path from "path";
import { PinExecConfig } from "../model/pin";

// Roadmap 7.5 — Run-target inference.
//
// When a file is pinned, detect runnable targets WITHIN it and offer them as the
// pin's run config, so the pin runs the right thing without the user typing a
// command. Three sources are recognized:
//   - package.json  -> its `scripts` (run via the detected package manager)
//   - Makefile      -> its targets (run via `make <target>`)
//   - a shebang     -> run the file directly (a blank command prefix)
// Each target produces a normal PinExecConfig; there is no special run path. A
// file with no detectable target yields an empty list and the caller falls back
// to today's behavior (the pin runs the file with its interpreter default).

// A discovered way to run the pinned file. `exec` is written verbatim onto the
// pin when chosen.
export interface RunTarget {
  // QuickPick label (carries a codicon).
  label: string;
  // Secondary line: the underlying command or script body, for disambiguation.
  detail?: string;
  exec: PinExecConfig;
}

// Files larger than this are not parsed for targets — a multi-megabyte file is
// not a package.json / Makefile, and reading it to scan would waste memory.
const MAX_PARSE_BYTES = 256 * 1024;

export async function detectRunTargets(uri: vscode.Uri): Promise<RunTarget[]> {
  const base = path.basename(uri.fsPath);
  const lower = base.toLowerCase();

  const text = await readTextCapped(uri);
  if (text === undefined) {
    return [];
  }

  if (lower === "package.json") {
    return packageJsonTargets(text, await detectPackageManager(uri));
  }
  if (lower === "makefile" || lower.endsWith(".mk")) {
    return makefileTargets(text);
  }
  return shebangTargets(text);
}

// Parse package.json `scripts` into one target per script. The file is the
// package.json in cwd, not an argument, so includeFilePath is false and the run
// is `<pm> run <name>` from the file's folder.
function packageJsonTargets(text: string, pm: string): RunTarget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") {
    return [];
  }
  const targets: RunTarget[] = [];
  for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
    targets.push({
      label: `$(play) ${pm} run ${name}`,
      detail: typeof body === "string" ? body : undefined,
      exec: {
        command: pm,
        args: ["run", name],
        cwd: "$dir",
        includeFilePath: false,
      },
    });
  }
  return targets;
}

// Pick the package manager from the lockfile beside package.json so the run
// matches how the project is actually managed; default to npm.
async function detectPackageManager(uri: vscode.Uri): Promise<string> {
  const dir = vscode.Uri.joinPath(uri, "..");
  const lockToPm: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [lock, pm] of lockToPm) {
    if (await fileExists(vscode.Uri.joinPath(dir, lock))) {
      return pm;
    }
  }
  return "npm";
}

// Parse Makefile target names: a line starting at column 0 with `name:` that is
// not a pattern rule, a special `.PHONY`-style target, or a variable assignment.
function makefileTargets(text: string): RunTarget[] {
  const seen = new Set<string>();
  const targets: RunTarget[] = [];
  const rule = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/;
  for (const line of text.split(/\r?\n/)) {
    const match = rule.exec(line);
    if (!match) {
      continue;
    }
    const name = match[1];
    // `%` pattern rules and duplicates are skipped; `.`-prefixed specials never
    // match the rule's leading character class, so they need no extra guard.
    if (name.includes("%") || seen.has(name)) {
      continue;
    }
    seen.add(name);
    targets.push({
      label: `$(play) make ${name}`,
      exec: {
        command: "make",
        args: [name],
        cwd: "$dir",
        includeFilePath: false,
      },
    });
  }
  return targets;
}

// Offer "run directly" for a shebang script — a blank command prefix means the
// runner executes the file itself (the OS honors the shebang on *nix).
function shebangTargets(text: string): RunTarget[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.startsWith("#!")) {
    return [];
  }
  return [
    {
      label: "$(play) Run directly (shebang)",
      detail: firstLine,
      exec: { command: "", includeFilePath: true },
    },
  ];
}

async function readTextCapped(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_PARSE_BYTES) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

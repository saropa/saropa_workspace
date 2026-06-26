import * as vscode from "vscode";
import { ShortcutAction } from "../model/shortcut";
import { GitRemote } from "./gitMeta";

// Leaf helpers shared by the recipe detectors: folder-root file reads, the small
// action builders, package-manager detection, host-aware git web URLs, and the
// parserless name extractors. Split out of detectors.ts so the catalog file holds
// the recipe definitions and these reusable primitives live on their own. None of
// these recurse — every read is at the workspace-folder root.

export async function readText(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(folder.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

export async function exists(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = Record<string, unknown>>(
  folder: vscode.WorkspaceFolder,
  name: string
): Promise<T | undefined> {
  const text = await readText(folder, name);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

// Build a shell-kind action that runs in the folder, visibly, in the terminal.
export function shell(folder: vscode.WorkspaceFolder, commandLine: string): ShortcutAction {
  return {
    kind: "shell",
    shellCommand: commandLine,
    cwd: folder.uri.fsPath,
    useIntegratedTerminal: true,
  };
}

export function url(target: string): ShortcutAction {
  return { kind: "url", url: target };
}

// Package manager from the lockfile next to package.json; defaults to npm.
export async function packageManager(folder: vscode.WorkspaceFolder): Promise<string> {
  if (await exists(folder, "pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (await exists(folder, "yarn.lock")) {
    return "yarn";
  }
  if (await exists(folder, "bun.lockb")) {
    return "bun";
  }
  return "npm";
}

// Host-aware web URLs from a normalized remote.
export function branchUrl(r: GitRemote, branch: string): string {
  return r.host === "gitlab"
    ? `${r.webBase}/-/tree/${branch}`
    : `${r.webBase}/tree/${branch}`;
}
export function compareUrl(r: GitRemote, branch: string): string {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${branch}`;
    case "bitbucket":
      return `${r.webBase}/pull-requests/new?source=${branch}`;
    default:
      return `${r.webBase}/compare/${branch}?expand=1`;
  }
}
export function commitsUrl(r: GitRemote, branch: string): string {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/commits/${branch}`;
    case "bitbucket":
      return `${r.webBase}/commits`;
    default:
      return `${r.webBase}/commits/${branch}`;
  }
}
export function issuesUrl(r: GitRemote): string {
  return r.host === "gitlab" ? `${r.webBase}/-/issues` : `${r.webBase}/issues`;
}
export function ciUrl(r: GitRemote): string {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/pipelines`;
    case "bitbucket":
      return `${r.webBase}/addon/pipelines/home`;
    default:
      return `${r.webBase}/actions`;
  }
}

export async function firstExisting(
  folder: vscode.WorkspaceFolder,
  names: string[]
): Promise<string | undefined> {
  for (const name of names) {
    if (await exists(folder, name)) {
      return name;
    }
  }
  return undefined;
}

export function hostName(r: GitRemote): string {
  switch (r.host) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "the remote";
  }
}

// Minimal name extraction from YAML/TOML without a parser dependency.
export function nameFromYaml(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const m = /^name:\s*(\S+)/m.exec(text);
  return m ? m[1].replace(/['"]/g, "") : undefined;
}
export function nameFromToml(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  // [project] name = "x" or [tool.poetry] name = "x"
  const m = /name\s*=\s*["']([^"']+)["']/.exec(text);
  return m ? m[1] : undefined;
}

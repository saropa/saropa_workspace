import * as path from "path";
import * as vscode from "vscode";
import { ShortcutAction } from "../model/shortcut";
import { GitRemote } from "./gitMeta";
// Case-insensitive path equality on Windows — used by walkUp's stop check.
import { pathEquals } from "../utils/pathCompare";

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

// True when the path stats successfully under the folder root; false for any stat
// failure (missing file is the common case, so this never throws).
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

// Reads and JSON-parses a file at the folder root; undefined when the file is
// missing or its content is not valid JSON (a manifest detector's normal miss,
// not an error worth surfacing).
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

// Every "open this link" recipe (repo home, PR queue, deployed site, registry
// listing, docs) needs the exact same one-field action shape; centralized here so
// a future field added to a url action (e.g. a target-window hint) is one edit,
// not one per detector.
export function url(target: string): ShortcutAction {
  return { kind: "url", url: target };
}

// Synthetic WorkspaceFolder from a bare directory path — only .uri is ever read by
// the helpers here (exists/readText/readJson), but name and index are filled in so
// the value satisfies the WorkspaceFolder interface contract. Shared by
// packageManager (walking parent directories) and recipeCommands.ts (deriving the
// package manager for a directory that has no real WorkspaceFolder of its own).
export function folderFrom(dir: string): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(dir), name: path.basename(dir), index: 0 };
}

// Walk upward from startDir (inclusive) to stopDir (inclusive), calling predicate at
// each directory and returning the first defined result. Bounded to 50 levels as a
// safety cap, not an expected depth — real directory trees stop long before that.
// Shared by packageManager (lockfile search) and recipeCommands.ts's
// findNearestPackageJson (package.json search): both walk the same
// "climb to the workspace root, then give up" shape, differing only in what each
// directory is tested for and what it returns.
export async function walkUp<T>(
  startDir: string,
  stopDir: string,
  predicate: (dir: string) => Promise<T | undefined>
): Promise<T | undefined> {
  let dir = startDir;
  for (let i = 0; i < 50; i++) {
    const result = await predicate(dir);
    if (result !== undefined) {
      return result;
    }
    const parent = path.dirname(dir);
    // Case-insensitive match on Windows: the workspace folder URI casing can
    // differ from path.dirname's resolved casing on case-preserving NTFS.
    if (pathEquals(dir, stopDir) || parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

// Package manager from the lockfile next to package.json, walking up parent
// directories when the given folder has none. A monorepo nested package (e.g.
// packages/foo/) usually has no lockfile of its own — the lockfile lives at the
// monorepo root — so checking only `folder` would silently default every
// pnpm/yarn/bun package to npm. Mirrors findNearestPackageJson's upward walk in
// recipeCommands.ts (both now built on the shared walkUp above): stop at the
// enclosing workspace folder when one is known (the common case), otherwise at the
// filesystem root.
export async function packageManager(folder: vscode.WorkspaceFolder): Promise<string> {
  // When the given folder IS the workspace folder (the common case),
  // getWorkspaceFolder returns it back, so stop === dir and the walk checks only
  // this level — correct, because lockfiles live at the workspace root. When a
  // synthetic subdirectory URI is passed (the recipeCommands.ts case), the walk
  // climbs to the enclosing workspace folder. When no workspace folder contains
  // the URI (untitled or external), stop at the filesystem root so the walk is
  // always bounded.
  const wsFolder = vscode.workspace.getWorkspaceFolder(folder.uri);
  const stop = wsFolder?.uri.fsPath ?? path.parse(folder.uri.fsPath).root;
  const found = await walkUp(folder.uri.fsPath, stop, async (dir) => {
    const dirFolder = folderFrom(dir);
    if (await exists(dirFolder, "pnpm-lock.yaml")) {
      return "pnpm";
    }
    if (await exists(dirFolder, "yarn.lock")) {
      return "yarn";
    }
    if (await exists(dirFolder, "bun.lockb")) {
      return "bun";
    }
    return undefined;
  });
  return found ?? "npm";
}

// Host-aware web URLs from a normalized remote.
export function branchUrl(r: GitRemote, branch: string): string {
  return r.host === "gitlab"
    ? `${r.webBase}/-/tree/${branch}`
    : `${r.webBase}/tree/${branch}`;
}
// PR/merge-request creation URL for the branch: GitHub's compare?expand=1 view,
// GitLab's merge_requests/new form, or Bitbucket's pull-requests/new form.
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
// Commit history URL for the branch. Bitbucket has no per-branch commits view, so
// it falls back to the repo's all-branches commits page.
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
// Issue tracker URL for the repo — GitLab nests it under /-/, every other host
// (including Bitbucket, which shares the plain /issues path) does not.
export function issuesUrl(r: GitRemote): string {
  return r.host === "gitlab" ? `${r.webBase}/-/issues` : `${r.webBase}/issues`;
}
// CI/pipelines URL for the repo: GitHub Actions, GitLab's pipelines view, or
// Bitbucket's pipelines add-on page, per host.
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

// The first name in the list that exists at the folder root, or undefined if none
// do — used to pick among several equivalent config filenames (e.g. eslint's many
// config file spellings) without checking them all every time.
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

// Human-readable display name for the remote's host kind, for use in recipe
// labels/descriptions ("Opens the repo on GitHub" rather than the raw enum).
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
// Extracts a bare `name = "x"` value, matching either a [project] (PEP 621) or a
// [tool.poetry] table — TOML's `key = "value"` syntax, unlike YAML's `key: value`.
export function nameFromToml(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  // [project] name = "x" or [tool.poetry] name = "x"
  const m = /name\s*=\s*["']([^"']+)["']/.exec(text);
  return m ? m[1] : undefined;
}

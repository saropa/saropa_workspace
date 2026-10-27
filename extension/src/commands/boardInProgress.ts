import * as vscode from "vscode";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { DEFAULT_IN_PROGRESS_MAX, clampInProgressMax, editedKey, parsePorcelainZ, relativeUnder, underPrefix } from "../board/inProgress";
import { BoardConfig } from "../board/types";

// Release Board, In progress: the settings and the names of the documents being edited in
// this window. A document counts when it is open and has unsaved edits, or is changed in the
// git working tree. The core picks and orders; this module only collects names. The work is
// bounded: only open documents inside a project are looked at, git is asked once per project
// about at most MAX_PATHS paths, and an answer is reused for a few seconds.

const execFile = promisify(execFileCb);
const GIT_TIMEOUT_MS = 5000;
const MAX_PATHS = 100;
const GIT_REUSE_MS = 4000;

export interface InProgressSettings {
  enabled: boolean;
  max: number;
}

// Reads the In progress settings; a bad value falls back to its default.
export function readInProgressSettings(): InProgressSettings {
  const c = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard.inProgress");
  return { enabled: c.get<boolean>("enabled", true), max: clampInProgressMax(c.get<number>("max", DEFAULT_IN_PROGRESS_MAX)) };
}

// Asks git which of the given paths (relative to `root`) are changed in the working tree:
// modified, staged, or new. Empty when git cannot answer (no repository, no git, a timeout).
export async function gitChanged(root: string, rels: string[]): Promise<string[]> {
  if (rels.length === 0) {
    return [];
  }
  try {
    const run = (args: string[]): Promise<{ stdout: string }> => execFile("git", args, { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    const [status, prefix] = await Promise.all([run(["status", "--porcelain=v1", "-z", "--", ...rels]), run(["rev-parse", "--show-prefix"])]);
    return underPrefix(parsePorcelainZ(status.stdout), prefix.stdout);
  } catch {
    return [];
  }
}

// What the lookup needs from the outside; tests replace both.
export interface EditedDeps {
  docs: () => ReadonlyArray<{ isDirty: boolean; uri: vscode.Uri }>;
  changed: (root: string, rels: string[]) => Promise<string[]>;
  ignoreCase: boolean;
}

const realDeps = (): EditedDeps => ({ docs: () => vscode.workspace.textDocuments, changed: gitChanged, ignoreCase: process.platform === "win32" });

// One answer from git per project folder, reused for a few seconds.
const recent = new Map<string, { at: number; paths: string; hit: string[] }>();

async function changedCached(deps: EditedDeps, root: string, rels: string[], now: number): Promise<string[]> {
  const sig = rels.join("\0");
  const hit = recent.get(root);
  if (hit && hit.paths === sig && now - hit.at < GIT_REUSE_MS) {
    return hit.hit;
  }
  const fresh = await deps.changed(root, rels);
  recent.set(root, { at: now, paths: sig, hit: fresh });
  return fresh;
}

// The documents open in this window that have unsaved edits or are changed in git, as
// "project/path" keys for the projects of the config. Files outside every project, and
// documents of other schemes (output panels, settings), are ignored.
export async function collectEdited(cfg: BoardConfig, deps: EditedDeps = realDeps(), now = Date.now()): Promise<string[]> {
  const open = deps.docs().filter((d) => d.uri.scheme === "file");
  const keys = new Set<string>();
  for (const p of cfg.projects) {
    const root = vscode.Uri.parse(p.path);
    if (root.scheme !== "file") {
      continue;
    }
    const mine: Array<{ rel: string; dirty: boolean }> = [];
    for (const d of open) {
      const rel = relativeUnder(root.fsPath, d.uri.fsPath, deps.ignoreCase);
      if (rel !== undefined && mine.length < MAX_PATHS) {
        mine.push({ rel, dirty: d.isDirty });
      }
    }
    if (mine.length === 0) {
      continue;
    }
    for (const m of mine.filter((x) => x.dirty)) {
      keys.add(editedKey(p.id, m.rel));
    }
    const clean = mine.filter((x) => !x.dirty).map((x) => x.rel);
    const changed = new Set((await changedCached(deps, root.fsPath, clean, now)).map((c) => (deps.ignoreCase ? c.toLowerCase() : c)));
    for (const rel of clean) {
      if (changed.has(deps.ignoreCase ? rel.toLowerCase() : rel)) {
        keys.add(editedKey(p.id, rel));
      }
    }
  }
  return [...keys];
}

// Forgets the reused git answers (for tests).
export function resetEditedCache(): void {
  recent.clear();
}

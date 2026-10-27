import * as path from "node:path";
import { BoardConfig, ProjectDef, RuleSetDef, SkippedProject } from "./types";

// Release Board, projects chosen by the user besides the open workspace folders. Pure: the
// host layer reads the setting and the folders and hands plain values in. Nothing here
// touches a file system.

// Most extra projects the board takes; the rest are listed as not read.
export const MAX_EXTRA_PROJECTS = 40;
// Most child folders looked at when a parent folder is added in one step.
export const MAX_PARENT_CHILDREN = 200;
// Longest path text accepted from the setting.
const MAX_PATH_LENGTH = 1024;

export type ProjectScope = "openOnly" | "all";

// The scope setting; anything unknown reads as "all".
export function asScope(v: unknown): ProjectScope {
  return v === "openOnly" ? "openOnly" : "all";
}

const isDrivePath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p);

// One folder path in a canonical text: normalized, no trailing separator (a root keeps its
// own), and the drive letter lower-cased so two spellings of one Windows folder compare equal.
export function folderKey(p: string): string {
  const isWin = isDrivePath(p);
  let s = isWin ? path.win32.normalize(p) : path.posix.normalize(p);
  while (s.length > 1 && /[\\/]$/.test(s) && !/^[A-Za-z]:[\\/]$/.test(s)) {
    s = s.slice(0, -1);
  }
  return isWin ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// The paths the setting holds that the board can use: text, absolute, no control characters,
// not a duplicate, not an open workspace folder. The first `max` are kept in order; the rest
// come back in `over`.
export function cleanProjectPaths(raw: unknown, open: readonly string[], max = MAX_EXTRA_PROJECTS): { paths: string[]; over: string[] } {
  const seen = new Set(open.map(folderKey));
  const paths: string[] = [];
  const over: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "string") {
      continue;
    }
    const text = item.trim();
    // eslint-disable-next-line no-control-regex
    if (text.length === 0 || text.length > MAX_PATH_LENGTH || /[\u0000-\u001f]/.test(text) || !(path.isAbsolute(text) || isDrivePath(text))) {
      continue;
    }
    const key = folderKey(text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    (paths.length < max ? paths : over).push(key);
  }
  return { paths, over };
}

// The setting's list after adding folders: the old order first, new folders after, no
// duplicates, no open folder, capped. `added` is how many new folders made it in.
export function addProjectPaths(current: unknown, add: readonly string[], open: readonly string[], max = MAX_EXTRA_PROJECTS): { paths: string[]; added: number } {
  const before = cleanProjectPaths(current, open, max).paths;
  const after = cleanProjectPaths([...before, ...add], open, max).paths;
  return { paths: after, added: after.length - before.length };
}

// The last part of a folder path, for a project name.
export function folderName(p: string): string {
  const parts = folderKey(p).split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

// What a folder holds, as far as telling a project from any other folder goes.
export interface Entry {
  name: string;
  dir: boolean;
  // A link to somewhere else: never followed when looking for projects.
  link?: boolean;
}

// True when the listing looks like a project: a git folder or file, a .saropa folder, or
// a plans, docs or bugs folder.
export function looksLikeProject(entries: readonly Entry[]): boolean {
  return entries.some((e) => {
    const n = e.name.toLowerCase();
    return n === ".git" || (e.dir && !e.link && (n === ".saropa" || n === "plans" || n === "docs" || n === "bugs"));
  });
}

// The child folders worth looking inside when a parent is added: real folders only (a link
// is never followed), no hidden folders, no node_modules, sorted, and at most `max`.
export function candidateChildren(children: readonly Entry[], max = MAX_PARENT_CHILDREN): { names: string[]; cut: number } {
  const names = children
    .filter((c) => c.dir && !c.link && !c.name.startsWith(".") && c.name !== "node_modules")
    .map((c) => c.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { names: names.slice(0, max), cut: Math.max(0, names.length - max) };
}

// A project path from a rules file kept inside its folder: relative, no ".." step. Returns
// the cleaned relative path ("" for the folder itself) or undefined when it is not allowed.
export function insidePath(p: unknown): string | undefined {
  if (typeof p !== "string" || p.includes("\0")) {
    return undefined;
  }
  const n = path.posix.normalize(p.replace(/\\/g, "/"));
  if (n === ".." || n.startsWith("../") || n.startsWith("/") || /^[A-Za-z]:/.test(n)) {
    return undefined;
  }
  return n === "." ? "" : n.replace(/\/+$/, "");
}

// A document folder name from a rules file: relative and inside the project.
function cleanRoots(roots: unknown): string[] {
  return (Array.isArray(roots) ? roots : []).map(insidePath).filter((r): r is string => typeof r === "string" && r !== "");
}

// What one extra folder adds to the board.
export interface FolderProjects {
  projects: ProjectDef[];
  // Rule sets the folder's own rules file defines, named "<id>:<set>" so they apply to its
  // projects only and never replace a set another project uses.
  ruleSets: Record<string, RuleSetDef>;
}

export interface FolderInput {
  // The folder's id (already unique) and name.
  id: string;
  name: string;
  // The folder as a URI text, and how to turn a path inside it into one.
  uri: string;
  join: (rel: string) => string;
  // The document folders the folder actually has.
  roots: string[];
  // The rule sets used when the folder has no project list of its own.
  defaultSets: string[];
  // The folder's own rules file, parsed, or undefined.
  parsed?: Partial<BoardConfig>;
  // Makes a project id unique among all projects.
  uniqueId: (name: string) => string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The projects an extra folder brings. With no rules file (or none that lists projects) the
// folder is one project over the default rule sets. With one, each listed project inside the
// folder becomes a project, and the file's own rule sets apply to them alone.
export function folderProjects(input: FolderInput): FolderProjects {
  const own = isRecord(input.parsed?.ruleSets) ? (input.parsed!.ruleSets as Record<string, RuleSetDef>) : {};
  const renamed: Record<string, RuleSetDef> = {};
  const map = new Map<string, string>();
  for (const [name, def] of Object.entries(own)) {
    map.set(name, `${input.id}:${name}`);
    renamed[`${input.id}:${name}`] = def;
  }
  const sets = (names: readonly unknown[]): string[] => names.filter((n): n is string => typeof n === "string").map((n) => map.get(n) ?? n);
  const listed = Array.isArray(input.parsed?.projects) ? input.parsed!.projects.filter(isRecord) : [];
  const projects: ProjectDef[] = [];
  for (const entry of listed) {
    const rel = insidePath(entry.path ?? "");
    if (rel === undefined) {
      continue;
    }
    const name = typeof entry.name === "string" && entry.name ? entry.name : typeof entry.id === "string" && entry.id ? entry.id : input.name;
    const def = entry as unknown as ProjectDef;
    projects.push({
      ...def,
      id: input.uniqueId(typeof entry.id === "string" && entry.id ? entry.id : name),
      name,
      path: rel === "" ? input.uri : input.join(rel),
      roots: cleanRoots(entry.roots),
      ruleSets: sets(Array.isArray(entry.ruleSets) ? entry.ruleSets : input.defaultSets),
      extra: true,
    });
  }
  if (projects.length === 0) {
    projects.push({ id: input.id, name: input.name, path: input.uri, roots: input.roots, ruleSets: sets(input.defaultSets), extra: true });
  }
  return { projects, ruleSets: renamed };
}

// The grey rows for chosen folders that could not be read, with the reason of each.
export function skippedRows(items: ReadonlyArray<{ path: string; reason: SkippedProject["reason"] }>): SkippedProject[] {
  return items.map((i) => ({ name: folderName(i.path), reason: i.reason }));
}

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { mapLimit } from "../board/pool";
import { withTimeout } from "../board/timeout";
import { GROUP_BYS, GroupBy, ProjectDef, RuleSetDef, SkipReason, SkippedProject } from "../board/types";
import { ProjectScope, asScope, cleanProjectPaths, folderName, folderProjects, skippedRows } from "../board/extraProjects";
import { pathExists } from "./boardFileSource";

// Release Board, the extra projects the user chose (a machine-level setting) read into
// projects of the board. Each goes through the same scanner and file source as a workspace
// folder; a folder that cannot be read becomes a grey row, never an error.

export const RULES_FILE_NAME = ".saropa/release-board.json";
const SECTION = "saropaWorkspace.releaseBoard";
// Longest a folder may take to answer before it counts as unreadable, and the largest rules
// file read from one.
const PROBE_MS = 4000;
const MAX_RULES_BYTES = 256 * 1024;
// Longest the whole check of one folder (listing, document folders, rules file) may take.
const FOLDER_MS = 10000;
const PROBE_PARALLEL = 6;

// The chosen folders from the user setting.
export function readProjectPaths(): unknown {
  return vscode.workspace.getConfiguration(SECTION).get<unknown>("projects", []);
}

export function readProjectScope(): ProjectScope {
  return asScope(vscode.workspace.getConfiguration(SECTION).get<unknown>("projectScope", "all"));
}

// Sets the scope; the setting change repaints the board through the configuration listener.
export async function writeProjectScope(scope: ProjectScope): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update("projectScope", scope, vscode.ConfigurationTarget.Global);
}

export function readGroupBy(): GroupBy {
  const v = vscode.workspace.getConfiguration(SECTION).get<string>("groupBy", "project");
  return GROUP_BYS.find((g) => g === v) ?? "project";
}

// Sets the grouping; the setting change repaints the board through the configuration listener.
export async function writeGroupBy(value: GroupBy): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update("groupBy", value, vscode.ConfigurationTarget.Global);
}

// The open workspace folders as plain paths, for telling an open folder from a chosen one.
export function openFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
}

// The chosen folders the board would use under the current setting.
export function chosenFolders(): { paths: string[]; over: string[] } {
  return cleanProjectPaths(readProjectPaths(), openFolderPaths());
}

// True when the board has something to read besides the open folders.
export function hasChosenFolders(): boolean {
  return readProjectScope() === "all" && chosenFolders().paths.length > 0;
}

// Folder status: undefined when readable, else the reason. A folder that does not answer in
// time (a dead network mount) counts as unreadable instead of holding the scan.
async function probe(uri: vscode.Uri): Promise<SkipReason | undefined> {
  try {
    const st = await withTimeout(Promise.resolve(vscode.workspace.fs.stat(uri)), PROBE_MS);
    if (!(st.type & vscode.FileType.Directory)) {
      return "notFolder";
    }
  } catch (e) {
    return isTimeout(e) ? "timedOut" : "missing";
  }
  try {
    await withTimeout(Promise.resolve(vscode.workspace.fs.readDirectory(uri)), PROBE_MS);
    return undefined;
  } catch (e) {
    return isTimeout(e) ? "timedOut" : "unreadable";
  }
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("timed out");
}

// The text of a small regular file inside the folder, or undefined. At most MAX_RULES_BYTES
// (+1, to tell "too large") are read whatever the file claims to be: links, devices and pipes
// are refused, and the file must stay inside the folder once links are resolved.
async function readSmallFile(root: string, rel: string): Promise<string | undefined> {
  const file = nodePath.join(root, rel);
  const info = await fs.lstat(file);
  if (!info.isFile()) {
    return undefined;
  }
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  if (!realFile.startsWith(realRoot.endsWith(nodePath.sep) ? realRoot : realRoot + nodePath.sep)) {
    return undefined;
  }
  const handle = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(MAX_RULES_BYTES + 1);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return bytesRead > MAX_RULES_BYTES ? undefined : buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

// The folder's own rules file, parsed; undefined when absent, too large, not a plain file or
// not valid JSON (the default rule sets then apply).
async function readFolderRules(root: vscode.Uri): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readSmallFile(root.fsPath, RULES_FILE_NAME);
    const parsed: unknown = text === undefined ? undefined : JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface ExtraProjects {
  projects: ProjectDef[];
  ruleSets: Record<string, RuleSetDef>;
  skipped: SkippedProject[];
  // Chosen projects the open-only scope leaves out.
  hidden: number;
}

// Reads the chosen folders into projects. `used` holds the ids of the open projects and
// grows with each new id; `defaultRoots` and `defaultSets` are the document folders and rule
// sets a folder without its own rules file gets.
export async function loadExtraProjects(used: Set<string>, uniqueId: (name: string, used: Set<string>) => string, defaultRoots: readonly string[], defaultSets: string[], folderMs = FOLDER_MS): Promise<ExtraProjects> {
  const out: ExtraProjects = { projects: [], ruleSets: {}, skipped: [], hidden: 0 };
  if (readProjectScope() !== "all") {
    out.hidden = chosenFolders().paths.length;
    return out;
  }
  const { paths, over } = chosenFolders();
  const checkOne = async (p: string): Promise<{ p: string; reason: SkipReason } | { p: string; uri: vscode.Uri; roots: string[]; parsed?: Record<string, unknown> }> => {
    const uri = vscode.Uri.file(p);
    const reason = await probe(uri);
    if (reason) {
      return { p, reason };
    }
    const roots: string[] = [];
    for (const r of defaultRoots) {
      if (await pathExists(vscode.Uri.joinPath(uri, r))) {
        roots.push(r);
      }
    }
    return { p, uri, roots, parsed: await readFolderRules(uri) };
  };
  // A folder that takes too long, or fails in any way, is one grey row, never a failed board.
  const checked = await mapLimit(paths, PROBE_PARALLEL, async (p) => {
    try {
      return await withTimeout(checkOne(p), folderMs);
    } catch (e) {
      return { p, reason: (isTimeout(e) ? "timedOut" : "unreadable") as SkipReason };
    }
  });
  const bad: Array<{ path: string; reason: SkipReason }> = [];
  for (const c of checked) {
    if ("reason" in c && c.reason) {
      bad.push({ path: c.p, reason: c.reason });
      continue;
    }
    const ok = c as { p: string; uri: vscode.Uri; roots: string[]; parsed?: Record<string, unknown> };
    const name = folderName(ok.p);
    const id = uniqueId(name, used);
    const made = folderProjects({
      id,
      idMadeUnique: id !== name,
      name,
      uri: ok.uri.toString(),
      join: (rel) => vscode.Uri.joinPath(ok.uri, rel).toString(),
      roots: ok.roots,
      defaultSets,
      parsed: ok.parsed,
      uniqueId: (n) => uniqueId(n, used),
    });
    out.projects.push(...made.projects);
    Object.assign(out.ruleSets, made.ruleSets);
  }
  out.skipped = [...skippedRows(bad), ...skippedRows(over.map((p) => ({ path: p, reason: "overLimit" as const })))];
  return out;
}

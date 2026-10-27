import * as vscode from "vscode";
import * as path from "node:path";
import defaultRules from "../board/defaultRules.json";
import { Profile, asProfile } from "../board/severity";
import { BoardConfig, ProjectDef } from "../board/types";
import { l10n } from "../i18n/l10n";
import { pathExists } from "./boardFileSource";
import { RULES_PATH, USER_RULE_SET } from "../board/ruleAssign";

// Release Board, loading the rule file. The user's own `.saropa/release-board.json` in the
// first folder wins over the rules shipped with the extension; a missing section falls back
// to the shipped one.

export const RULES_FILE = RULES_PATH;
// Folders a project may keep its documents in; only the ones that exist are scanned.
export const DEFAULT_ROOTS = ["bugs", "docs", "plans", "reports", "db-access"];
const DEFAULT_SETS = ["folder-states", "reference-docs", "doc-kinds", "live-folders", "status-line"];

// The user's rules layered over the shipped ones. A user file may leave out any section;
// rule sets are merged by name.
export function layerUserRules(shipped: BoardConfig, parsed: Partial<BoardConfig>): BoardConfig {
  return {
    ...shipped,
    ...parsed,
    ignore: parsed.ignore ?? shipped.ignore,
    ruleSets: { ...shipped.ruleSets, ...(parsed.ruleSets ?? {}) },
    projects: parsed.projects ?? [],
  };
}

// A project id from a folder name that is not in `used`. Two folders can share a name; the
// project id must stay unique. The id is added to `used`.
export function uniqueProjectId(name: string, used: Set<string>): string {
  let id = name;
  for (let n = 2; used.has(id); n++) {
    id = `${name}-${n}`;
  }
  used.add(id);
  return id;
}

// Gate shared by every board command. Returns false (after telling the user why) when
// the board is off or there is nothing to scan.
export function boardReady(quiet = false): boolean {
  const enabled = vscode.workspace
    .getConfiguration("saropaWorkspace.releaseBoard")
    .get<boolean>("enabled", true);
  if (!enabled) {
    if (!quiet) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.disabled"));
    }
    return false;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    if (!quiet) {
      void vscode.window.showInformationMessage(l10n("releaseBoard.noFolder"));
    }
    return false;
  }
  return true;
}

// The shipped rules, with the user's file layered over them when one exists.
async function readRules(folders: readonly vscode.WorkspaceFolder[]): Promise<BoardConfig> {
  const shipped = defaultRules as unknown as BoardConfig;
  if (folders.length === 0) {
    return { ...shipped };
  }
  const user = vscode.Uri.joinPath(folders[0].uri, RULES_FILE);
  if (!(await pathExists(user))) {
    return { ...shipped };
  }
  const bytes = await vscode.workspace.fs.readFile(user);
  return layerUserRules(shipped, JSON.parse(Buffer.from(bytes).toString("utf8")) as Partial<BoardConfig>);
}

// One project per workspace folder, scanning the document folders it actually has.
// A rule added from the board (the "my-rules" rule set) applies to these projects too.
async function foldersAsProjects(folders: readonly vscode.WorkspaceFolder[], userRules: boolean): Promise<ProjectDef[]> {
  const projects: ProjectDef[] = [];
  const used = new Set<string>();
  for (const f of folders) {
    const roots: string[] = [];
    for (const r of DEFAULT_ROOTS) {
      if (await pathExists(vscode.Uri.joinPath(f.uri, r))) {
        roots.push(r);
      }
    }
    const id = uniqueProjectId(f.name, used);
    projects.push({ id, name: f.name, path: f.uri.toString(), roots, ruleSets: userRules ? [...DEFAULT_SETS, USER_RULE_SET] : DEFAULT_SETS });
  }
  return projects;
}

// The rule file: the user's own `.saropa/release-board.json` in the first folder when
// present, else the rules shipped with the extension. When no projects are listed,
// every workspace folder becomes one. Project paths become URI strings so remote and
// virtual workspaces resolve correctly.
export async function loadConfig(): Promise<BoardConfig> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  let cfg = await readRules(folders);
  // A profile chosen in settings wins over the rules file.
  const setting = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").inspect<Profile>("profile");
  const chosen = setting?.workspaceFolderValue ?? setting?.workspaceValue ?? setting?.globalValue;
  cfg = { ...cfg, profile: asProfile(chosen ?? cfg.profile) };
  if (cfg.projects.length > 0) {
    const base = folders[0].uri;
    const projects = cfg.projects.map((p) => ({
      ...p,
      path: (path.isAbsolute(p.path) ? (base.scheme === "file" ? vscode.Uri.file(p.path) : base.with({ path: p.path })) : vscode.Uri.joinPath(base, p.path)).toString(),
    }));
    return { ...cfg, projects };
  }
  return { ...cfg, projects: await foldersAsProjects(folders, USER_RULE_SET in cfg.ruleSets) };
}

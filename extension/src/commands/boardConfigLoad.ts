import * as vscode from "vscode";
import * as path from "node:path";
import defaultRules from "../board/defaultRules.json";
import { Profile, asProfile } from "../board/severity";
import { BoardConfig, ProjectDef } from "../board/types";
import { l10n } from "../i18n/l10n";
import { pathExists } from "./boardFileSource";
import { OVERRIDE_RULE_SET, RULES_PATH, USER_RULE_SET } from "../board/ruleAssign";
import { hasChosenFolders, loadExtraProjects } from "./boardExtraProjects";

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
    ignore: Array.isArray(parsed.ignore) ? parsed.ignore : shipped.ignore,
    ruleSets: { ...shipped.ruleSets, ...(parsed.ruleSets && typeof parsed.ruleSets === "object" && !Array.isArray(parsed.ruleSets) ? parsed.ruleSets : {}) },
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
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
  // Chosen projects are enough on their own: a window with no folder open can still show them.
  if (!vscode.workspace.workspaceFolders?.length && !hasChosenFolders()) {
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    // A damaged rules file must not stop the board opening: the shipped rules apply until it is fixed.
    return { ...shipped };
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? layerUserRules(shipped, parsed as Partial<BoardConfig>) : { ...shipped };
}

// The rule sets every folder project reads: the rules written for one document first, the shipped
// sets, then the rules written for a folder. A written rule names its project, so a set shared
// by all projects never changes another project's documents.
export function ruleSetsFor(cfg: BoardConfig): string[] {
  return [...(OVERRIDE_RULE_SET in cfg.ruleSets ? [OVERRIDE_RULE_SET] : []), ...DEFAULT_SETS, ...(USER_RULE_SET in cfg.ruleSets ? [USER_RULE_SET] : [])];
}

// A chosen project that names its own rule sets still reads the rules written from the board:
// the "my-overrides" set first and the "my-rules" set last, when the file has them.
function withUserSets(p: ProjectDef, cfg: BoardConfig): ProjectDef {
  const first = OVERRIDE_RULE_SET in cfg.ruleSets && !p.ruleSets.includes(OVERRIDE_RULE_SET) ? [OVERRIDE_RULE_SET] : [];
  const last = USER_RULE_SET in cfg.ruleSets && !p.ruleSets.includes(USER_RULE_SET) ? [USER_RULE_SET] : [];
  return first.length + last.length === 0 ? p : { ...p, ruleSets: [...first, ...p.ruleSets, ...last] };
}

// One project per workspace folder, scanning the document folders it actually has.
// A rule added from the board (the "my-rules" rule set) applies to these projects too.
async function foldersAsProjects(folders: readonly vscode.WorkspaceFolder[], sets: string[]): Promise<ProjectDef[]> {
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
    projects.push({ id, name: f.name, path: f.uri.toString(), roots, ruleSets: sets, ...(id !== f.name ? { idMadeUnique: true } : {}) });
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
  // Globs from settings are added to the ignore list of the rules file.
  const exclude = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<string[]>("exclude", []);
  cfg = { ...cfg, ignore: [...cfg.ignore, ...exclude] };
  const open = await openProjects(cfg, folders);
  // The user's extra projects follow the open ones, read the same way.
  const extra = await loadExtraProjects(new Set(open.map((p) => p.id)), uniqueProjectId, DEFAULT_ROOTS, ruleSetsFor(cfg));
  if (extra.projects.length === 0 && extra.skipped.length === 0 && extra.hidden === 0) {
    return { ...cfg, projects: open };
  }
  return {
    ...cfg,
    projects: [...open, ...extra.projects.map((p) => withUserSets(p, cfg))],
    ruleSets: { ...cfg.ruleSets, ...extra.ruleSets },
    ...(extra.skipped.length > 0 ? { skipped: extra.skipped } : {}),
    ...(extra.hidden > 0 ? { hidden: extra.hidden } : {}),
  };
}

// The projects of the open workspace: those the rules file lists, else one per folder.
async function openProjects(cfg: BoardConfig, folders: readonly vscode.WorkspaceFolder[]): Promise<ProjectDef[]> {
  if (cfg.projects.length > 0) {
    const base = folders[0].uri;
    return cfg.projects.map((p) => ({
      ...p,
      path: (path.isAbsolute(p.path) ? (base.scheme === "file" ? vscode.Uri.file(p.path) : base.with({ path: p.path })) : vscode.Uri.joinPath(base, p.path)).toString(),
    }));
  }
  return foldersAsProjects(folders, ruleSetsFor(cfg));
}

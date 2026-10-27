import * as vscode from "vscode";
import { BoardItem } from "../board/boardModel";
import { relativeTo } from "../board/editorLinks";
import { DEFAULT_LINT_FILE } from "../board/health";
import { isNameableSource } from "../board/docFacts";
import { Counts, LiveSignals, LiveUnnamed, PathLookup, SignalsApi, apiUsable, bugDocument, clampLookbackDays, normRel, parseLintViolations, pathKey, readApiSignals } from "../board/liveEvidence";
import { withTimeout } from "../board/timeout";
import { l10n } from "../i18n/l10n";
import { BoardRun } from "./releaseBoardCommands";

// Release Board, live evidence, VS Code layer. Three sources, all local and all optional:
// the Problems panel (VS Code diagnostics), the Saropa Lints violations file the board
// already reads for project health, and, when installed, Log Capture's `signalsForFiles`
// member. Nothing here starts a scan, runs a tool or touches the network. Heavy work is
// async, bounded and cached; a source that is absent or slow is skipped silently.

const SETTINGS = "saropaWorkspace.releaseBoard.liveEvidence";
const LOG_EXT = "saropa.saropa-log-capture";
const API_TIMEOUT_MS = 3000;
const API_CACHE_MS = 60 * 1000;
// Files asked of Log Capture, per project.
const MAX_PATHS = 300;
// A lint file larger than this is not read.
const MAX_LINT_BYTES = 16 * 1024 * 1024;
const FOLD = process.platform === "win32" || process.platform === "darwin";

export interface LiveSettings {
  enabled: boolean;
  includeWarnings: boolean;
  lookbackDays: number;
  unnamedBox: boolean;
}

export function readLiveSettings(): LiveSettings {
  const c = vscode.workspace.getConfiguration(SETTINGS);
  const board = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard");
  return {
    enabled: board.get<boolean>("enabled", true) && c.get<boolean>("enabled", true),
    includeWarnings: c.get<boolean>("includeWarnings", true),
    lookbackDays: clampLookbackDays(c.get<number>("lookbackDays", 1)),
    unnamedBox: c.get<boolean>("unnamedBox", true),
  };
}

export const liveFold = FOLD;

function add(out: LiveSignals, project: string, rel: string): NonNullable<LiveSignals[string][string]> {
  const mine = (out[project] ??= {});
  return (mine[rel] ??= {});
}

// Errors and warnings the editor already holds for a file.
function problemCounts(diags: readonly vscode.Diagnostic[] | undefined): Counts | undefined {
  let errors = 0;
  let warnings = 0;
  for (const d of diags ?? []) {
    if (d.severity === vscode.DiagnosticSeverity.Error) {
      errors += 1;
    } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
      warnings += 1;
    }
  }
  return errors + warnings > 0 ? { errors, warnings } : undefined;
}

const lintCache = new Map<string, { mtime: number; size: number; counts: Map<string, Counts> }>();

async function lintCounts(root: vscode.Uri, rel: string, staleMs: number): Promise<Map<string, Counts>> {
  const uri = vscode.Uri.joinPath(root, rel);
  try {
    const st = await vscode.workspace.fs.stat(uri);
    // A stale file is not live: the health line already says so.
    if (st.size > MAX_LINT_BYTES || Date.now() - st.mtime > staleMs) {
      return new Map();
    }
    const key = uri.toString();
    const hit = lintCache.get(key);
    if (hit && hit.mtime === st.mtime && hit.size === st.size) {
      return hit.counts;
    }
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const counts = parseLintViolations(text, root.scheme === "file" ? root.fsPath : undefined, FOLD);
    lintCache.set(key, { mtime: st.mtime, size: st.size, counts });
    return counts;
  } catch {
    return new Map();
  }
}

let apiCache: { key: string; at: number; rows: ReturnType<typeof readApiSignals> } | undefined;
// When Log Capture last failed or timed out; it is not asked again for API_CACHE_MS.
let apiFailAt = 0;

// Log Capture, when installed, already running and new enough. Silent on every failure;
// gives up after 3 s and then leaves it alone for a minute. It is never started from here.
async function logSignals(paths: string[], lookup: PathLookup, sinceDays: number): Promise<ReturnType<typeof readApiSignals>> {
  if (paths.length === 0 || Date.now() - apiFailAt < API_CACHE_MS) {
    return [];
  }
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const key = since + "\t" + [...lookup.keys()].sort().join("\n");
  if (apiCache && apiCache.key === key && Date.now() - apiCache.at < API_CACHE_MS) {
    return apiCache.rows;
  }
  const ext = vscode.extensions.getExtension(LOG_EXT);
  if (!ext || !ext.isActive) {
    return [];
  }
  try {
    const api = ext.exports as SignalsApi | undefined;
    if (!apiUsable(api)) {
      return [];
    }
    const ask = (api as { signalsForFiles: (p: string[], s: string) => Promise<unknown> }).signalsForFiles.bind(api);
    const rows = readApiSignals(await withTimeout(Promise.resolve(ask(paths, since)), API_TIMEOUT_MS), lookup, FOLD);
    apiCache = { key, at: Date.now(), rows };
    return rows;
  } catch {
    // Log Capture failing or slow is no reason to disturb the board.
    apiFailAt = Date.now();
    return [];
  }
}

// The deepest project that holds a file, so a file in a nested project is counted once.
function owner(projects: Array<{ id: string; root: vscode.Uri }>, uri: vscode.Uri): { id: string; rel: string } | undefined {
  let best: { id: string; rel: string; len: number } | undefined;
  for (const p of projects) {
    const rel = p.root.scheme === uri.scheme && p.root.authority === uri.authority ? relativeTo(p.root.path, uri.path, FOLD) : undefined;
    if (rel !== undefined && (!best || p.root.path.length > best.len)) {
      best = { id: p.id, rel, len: p.root.path.length };
    }
  }
  return best;
}

// The signals for the files the open documents name. Files with an error now (Problems or
// lint) are also asked of Log Capture, for the "no document" box. Never throws.
export async function loadLiveSignals(run: BoardRun, items: BoardItem[], s: LiveSettings): Promise<LiveSignals> {
  const out: LiveSignals = {};
  try {
    // One read of the Problems panel for all projects.
    const all = vscode.languages.getDiagnostics();
    const byUri = new Map(all.map(([u, d]) => [u.toString(), d]));
    const projects = run.cfg.projects.map((p) => ({ id: p.id, root: vscode.Uri.parse(p.path) }));
    const erroring = new Map<string, string[]>();
    for (const [uri, diags] of all) {
      if (uri.scheme !== "file" || !diags.some((d) => d.severity === vscode.DiagnosticSeverity.Error)) {
        continue;
      }
      const o = owner(projects, uri);
      if (o) {
        erroring.set(o.id, [...(erroring.get(o.id) ?? []), o.rel]);
      }
    }
    const lookup: PathLookup = new Map();
    const paths: string[] = [];
    const ask = (project: string, root: vscode.Uri, rel: string): void => {
      const fs = vscode.Uri.joinPath(root, rel).fsPath;
      const k = pathKey(fs, FOLD);
      const list = lookup.get(k);
      if (list) {
        list.push({ project, rel });
      } else {
        lookup.set(k, [{ project, rel }]);
        paths.push(fs);
      }
    };
    for (const p of run.cfg.projects) {
      const root = vscode.Uri.parse(p.path);
      const named = new Map<string, string>();
      for (const it of items) {
        if (it.project === p.id) {
          for (const f of run.result.snapshot.projects[p.id]?.facts[it.path]?.facts.sourceFiles ?? []) {
            named.set(normRel(f, FOLD), f);
          }
        }
      }
      const staleMs = (p.health?.staleDays ?? 7) * 86400000;
      const lints = await lintCounts(root, p.health?.lintFile ?? DEFAULT_LINT_FILE, staleMs);
      const lintKeys = new Map([...lints].map(([k, v]) => [normRel(k, FOLD), v]));
      for (const [k, f] of named) {
        const pc = problemCounts(byUri.get(vscode.Uri.joinPath(root, f).toString()));
        const lc = lintKeys.get(k);
        if (pc) {
          add(out, p.id, f).problems = pc;
        }
        if (lc) {
          add(out, p.id, f).lints = lc;
        }
      }
      if (root.scheme !== "file") {
        continue;
      }
      // Files to ask Log Capture about: the named ones first, then files with an error now
      // that a document could name. The budget is per project.
      const want = new Map(named);
      for (const f of [...[...lints].filter(([, c]) => c.errors > 0).map(([k]) => k), ...(erroring.get(p.id) ?? [])]) {
        if (isNameableSource(normRel(f, false), run.cfg.sourceDirs) && !want.has(normRel(f, FOLD))) {
          want.set(normRel(f, FOLD), normRel(f, false));
        }
      }
      for (const f of [...want.values()].slice(0, MAX_PATHS)) {
        ask(p.id, root, f);
      }
    }
    for (const r of await logSignals(paths, lookup, s.lookbackDays)) {
      add(out, r.project, r.rel).logs = r.logs;
    }
  } catch {
    // Whatever was gathered so far is still true; the rest is simply absent.
  }
  return out;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// Writes one new bug document for a listed signal and opens it. Never overwrites: the file is
// created with overwrite off, and a taken name gets a number. The folder must stay inside the
// project. Returns true when a file was written.
export async function startBugDocument(projectRoot: vscode.Uri, u: LiveUnnamed, lookbackDays: number): Promise<boolean> {
  if (!u.folder) {
    return false;
  }
  const doc = bugDocument(u, Date.now(), lookbackDays);
  const dir = vscode.Uri.joinPath(projectRoot, u.folder);
  if (relativeTo(projectRoot.path, dir.path, FOLD) === undefined) {
    return false;
  }
  await vscode.workspace.fs.createDirectory(dir);
  for (let n = 1; n < 20; n++) {
    const target = vscode.Uri.joinPath(dir, n === 1 ? doc.name : doc.name.replace(/\.md$/, `_${n}.md`));
    if (relativeTo(projectRoot.path, target.path, FOLD) === undefined || (await exists(target))) {
      continue;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(target, { overwrite: false, ignoreIfExists: false });
    edit.insert(target, new vscode.Position(0, 0), doc.text);
    // A refused edit means the name was taken in the meantime: try the next one.
    if (await vscode.workspace.applyEdit(edit)) {
      const opened = await vscode.workspace.openTextDocument(target);
      await opened.save();
      await vscode.window.showTextDocument(opened, { preview: false });
      return true;
    }
  }
  void vscode.window.showWarningMessage(l10n("releaseBoard.live.exists", { path: `${u.folder}/${doc.name}` }));
  return false;
}

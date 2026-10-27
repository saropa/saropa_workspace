import * as vscode from "vscode";
import { BoardItem } from "../board/boardModel";
import { relativeTo } from "../board/editorLinks";
import { DEFAULT_LINT_FILE } from "../board/health";
import { Counts, LiveSignals, LiveUnnamed, SignalsApi, apiUsable, bugDocument, clampLookbackDays, parseLintViolations, readApiSignals } from "../board/liveEvidence";
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

type Sources = { [project: string]: Map<string, { project: string; rel: string }> };

function add(out: LiveSignals, project: string, rel: string): NonNullable<LiveSignals[string][string]> {
  const mine = (out[project] ??= {});
  return (mine[rel] ??= {});
}

// Errors and warnings the editor already holds for a file. Only a file with entries is touched.
function problemCounts(uri: vscode.Uri): Counts | undefined {
  let errors = 0;
  let warnings = 0;
  for (const d of vscode.languages.getDiagnostics(uri)) {
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

// Log Capture, when installed and new enough. Silent on every failure; gives up after 3 s.
async function logSignals(paths: Map<string, { project: string; rel: string }>, sinceDays: number): Promise<ReturnType<typeof readApiSignals>> {
  if (paths.size === 0) {
    return [];
  }
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const key = since + "\t" + [...paths.keys()].sort().join("\n");
  if (apiCache && apiCache.key === key && Date.now() - apiCache.at < API_CACHE_MS) {
    return apiCache.rows;
  }
  try {
    const ext = vscode.extensions.getExtension(LOG_EXT);
    if (!ext) {
      return [];
    }
    const rows = await withTimeout(
      (async () => {
        const api = (ext.isActive ? ext.exports : await ext.activate()) as SignalsApi | undefined;
        if (!apiUsable(api)) {
          return [];
        }
        const ask = (api as { signalsForFiles: (p: string[], s: string) => Promise<unknown> }).signalsForFiles.bind(api);
        return readApiSignals(await ask([...paths.keys()], since), paths);
      })(),
      API_TIMEOUT_MS
    );
    apiCache = { key, at: Date.now(), rows };
    return rows;
  } catch {
    // Log Capture failing or slow is no reason to disturb the board.
    return apiCache?.key === key ? apiCache.rows : [];
  }
}

// The signals for the files the open documents name, plus the files that have an error now
// (asked of Log Capture only, for the "no document" box). Never throws.
export async function loadLiveSignals(run: BoardRun, items: BoardItem[], s: LiveSettings): Promise<LiveSignals> {
  const out: LiveSignals = {};
  try {
    const asked: Sources = {};
    let total = 0;
    const staleOf = (id: string): number => (run.cfg.projects.find((p) => p.id === id)?.health?.staleDays ?? 7) * 86400000;
    for (const p of run.cfg.projects) {
      const root = vscode.Uri.parse(p.path);
      const named = new Set<string>();
      for (const it of items) {
        if (it.project === p.id) {
          for (const f of run.result.snapshot.projects[p.id]?.facts[it.path]?.facts.sourceFiles ?? []) {
            named.add(f);
          }
        }
      }
      const lints = await lintCounts(root, p.health?.lintFile ?? DEFAULT_LINT_FILE, staleOf(p.id));
      const lintKeys = FOLD ? new Map([...lints].map(([k, v]) => [k.toLowerCase(), v])) : lints;
      for (const f of named) {
        const pc = problemCounts(vscode.Uri.joinPath(root, f));
        const lc = lintKeys.get(FOLD ? f.toLowerCase() : f);
        if (pc) {
          add(out, p.id, f).problems = pc;
        }
        if (lc) {
          add(out, p.id, f).lints = lc;
        }
      }
      // Files to ask Log Capture about: the named ones, and files with an error now.
      const candidates = new Set(named);
      for (const [f, c] of lints) {
        if (c.errors > 0) {
          candidates.add(f);
        }
      }
      if (root.scheme === "file") {
        for (const [uri, diags] of vscode.languages.getDiagnostics()) {
          const rel = uri.scheme === "file" ? relativeTo(root.path, uri.path, FOLD) : undefined;
          if (rel && diags.some((d) => d.severity === vscode.DiagnosticSeverity.Error)) {
            candidates.add(rel);
          }
        }
        const map: Sources[string] = (asked[p.id] = new Map());
        for (const f of candidates) {
          if (total < MAX_PATHS) {
            total += 1;
            map.set(vscode.Uri.joinPath(root, f).fsPath, { project: p.id, rel: f });
          }
        }
      }
    }
    const lookup = new Map<string, { project: string; rel: string }>();
    for (const m of Object.values(asked)) {
      for (const [k, v] of m) {
        lookup.set(k, v);
      }
    }
    for (const r of await logSignals(lookup, s.lookbackDays)) {
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

// Writes one new bug document for a listed signal and opens it. Never overwrites: a taken
// name gets a number. Returns true when a file was written.
export async function startBugDocument(projectRoot: vscode.Uri, u: LiveUnnamed, lookbackDays: number): Promise<boolean> {
  if (!u.folder) {
    return false;
  }
  const doc = bugDocument(u, Date.now(), lookbackDays);
  const dir = vscode.Uri.joinPath(projectRoot, u.folder);
  let target = vscode.Uri.joinPath(dir, doc.name);
  for (let n = 2; (await exists(target)) && n < 20; n++) {
    target = vscode.Uri.joinPath(dir, doc.name.replace(/\.md$/, `_${n}.md`));
  }
  if (await exists(target)) {
    void vscode.window.showWarningMessage(l10n("releaseBoard.live.exists", { path: `${u.folder}/${doc.name}` }));
    return false;
  }
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(target, Buffer.from(doc.text, "utf8"));
  await vscode.window.showTextDocument(target, { preview: false });
  return true;
}

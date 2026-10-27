import * as vscode from "vscode";
import { DEFAULT_LINT_FILE, HealthFile, LintRead, ProjectHealth, RecordedRuns, RunRecord, evaluateHealth, parseLintsFile, parseTestTally } from "../board/health";
import { BoardConfig } from "../board/types";
import { runOutputs } from "../exec/runOutputs";
import { runStatusRegistry } from "../exec/runStatus";
import { ShortcutStore } from "../model/shortcutStore";
import { shortcutDisplayName } from "../model/shortcutDisplayName";

// Release Board code health, VS Code layer. Two sources of evidence, both optional:
// the last background run of a shortcut a project names as its test or lint run (only
// background runs have an exit code we observe; other runs are never counted), and the
// Saropa Lints violations file. Run records are kept in the board's own storage so they
// survive a reload; the run status shown elsewhere stays in memory as before.

const HEALTH_FILE = "release-board-health.json";

async function readHealthFile(dir: vscode.Uri): Promise<HealthFile> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, HEALTH_FILE));
    const f = JSON.parse(Buffer.from(bytes).toString("utf8")) as Partial<HealthFile>;
    return f.version === 1 ? { version: 1, projects: f.projects ?? {}, seen: f.seen ?? {} } : { version: 1, projects: {}, seen: {} };
  } catch {
    return { version: 1, projects: {}, seen: {} };
  }
}

async function writeHealthFile(dir: vscode.Uri, f: HealthFile): Promise<void> {
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, HEALTH_FILE), Buffer.from(JSON.stringify(f), "utf8"));
}

// An id always matches. A name matches only when exactly one shortcut carries it, so two
// shortcuts called "Run tests" never feed each other's project.
function nameCounts(store: ShortcutStore): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of [...store.getProjectShortcuts(), ...store.getGlobalShortcuts()]) {
    const n = shortcutDisplayName(s).toLowerCase();
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}

function matches(list: string[] | undefined, id: string, name: string, counts: Map<string, number>): boolean {
  const n = name.toLowerCase();
  return (list ?? []).some((x) => x === id || (x.toLowerCase() === n && counts.get(n) === 1));
}

// Fires after a run was recorded, so an open board can rescan.
const recorded = new vscode.EventEmitter<void>();
export const onDidRecordHealth = recorded.event;

// Records finished background runs of the shortcuts the projects name.
async function record(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): Promise<void> {
  const enabled = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("enabled", false);
  if (!enabled) {
    return;
  }
  const dir = context.storageUri ?? context.globalStorageUri;
  const file = await readHealthFile(dir);
  let cfg: BoardConfig | undefined;
  let counts: Map<string, number> | undefined;
  let changed = false;
  for (const [pinId, res] of runStatusRegistry.entries()) {
    if (res.endedAt <= (file.seen[pinId] ?? 0)) {
      continue;
    }
    file.seen[pinId] = res.endedAt;
    changed = true;
    const shortcut = store.findShortcut(pinId);
    if (!shortcut) {
      continue;
    }
    // Only a background run counts: it alone leaves a captured output stamped with the same
    // end time. Routines, terminal, macro and report runs also write a status, and none of
    // them is evidence.
    if (runOutputs.latest(pinId)?.endedAt !== res.endedAt) {
      continue;
    }
    cfg ??= await loadConfig();
    counts ??= nameCounts(store);
    const name = shortcutDisplayName(shortcut);
    for (const p of cfg.projects) {
      const asTests = matches(p.health?.tests, pinId, name, counts);
      const asLint = matches(p.health?.lint, pinId, name, counts);
      if (!asTests && !asLint) {
        continue;
      }
      const rec: RunRecord = { pinId, name, outcome: res.outcome, exitCode: res.exitCode, endedAt: res.endedAt };
      if (asTests) {
        const out = runOutputs.latest(pinId)?.output;
        const tally = out ? parseTestTally(out) : undefined;
        file.projects[p.id] = { ...file.projects[p.id], tests: { ...rec, ...tally } };
      }
      if (asLint) {
        file.projects[p.id] = { ...file.projects[p.id], lint: rec };
      }
    }
  }
  if (changed) {
    await writeHealthFile(dir, file);
    recorded.fire();
  }
}

// One recording at a time: two overlapping reads of the file would let the older write win.
let chain: Promise<void> = Promise.resolve();

export function startHealthRecorder(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): void {
  context.subscriptions.push(runStatusRegistry.onDidChange(() => {
      chain = chain.then(() => record(context, store, loadConfig)).catch(() => undefined);
    }),
    recorded);
}

async function readLints(root: string, rel: string): Promise<LintRead | undefined> {
  const uri = vscode.Uri.joinPath(vscode.Uri.parse(root), rel);
  try {
    const st = await vscode.workspace.fs.stat(uri);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseLintsFile(Buffer.from(bytes).toString("utf8"), st.mtime);
  } catch {
    return undefined;
  }
}

// Health of every project, from the recorded runs and the Lints file.
export async function collectHealth(context: vscode.ExtensionContext, store: ShortcutStore, cfg: BoardConfig, now = Date.now()): Promise<Record<string, ProjectHealth>> {
  const file = await readHealthFile(context.storageUri ?? context.globalStorageUri);
  const out: Record<string, ProjectHealth> = {};
  for (const p of cfg.projects) {
    const lints = await readLints(p.path, p.health?.lintFile ?? DEFAULT_LINT_FILE);
    // A record counts only while its shortcut is still the one the project names.
    const counts = nameCounts(store);
    const configured = (list: string[] | undefined, r: RunRecord | undefined): RunRecord | undefined => {
      const s = r?.pinId ? store.findShortcut(r.pinId) : undefined;
      return r && s && matches(list, r.pinId!, shortcutDisplayName(s), counts) ? r : undefined;
    };
    const recorded = file.projects[p.id];
    const runs: RecordedRuns = { tests: configured(p.health?.tests, recorded?.tests), lint: configured(p.health?.lint, recorded?.lint) };
    out[p.id] = evaluateHealth(p.health, runs, lints, now);
  }
  return out;
}

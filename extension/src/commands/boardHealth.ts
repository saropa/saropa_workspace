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
    const f = JSON.parse(Buffer.from(bytes).toString("utf8")) as HealthFile;
    return f.version === 1 ? f : { version: 1, projects: {}, seen: {} };
  } catch {
    return { version: 1, projects: {}, seen: {} };
  }
}

async function writeHealthFile(dir: vscode.Uri, f: HealthFile): Promise<void> {
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, HEALTH_FILE), Buffer.from(JSON.stringify(f), "utf8"));
}

function matches(list: string[] | undefined, id: string, name: string): boolean {
  const n = name.toLowerCase();
  return (list ?? []).some((x) => x === id || x.toLowerCase() === n);
}

// Records finished background runs of the shortcuts the projects name.
async function record(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): Promise<void> {
  const enabled = vscode.workspace.getConfiguration("saropaWorkspace.releaseBoard").get<boolean>("enabled", false);
  if (!enabled) {
    return;
  }
  const dir = context.storageUri ?? context.globalStorageUri;
  const file = await readHealthFile(dir);
  let cfg: BoardConfig | undefined;
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
    cfg ??= await loadConfig();
    const name = shortcutDisplayName(shortcut);
    for (const p of cfg.projects) {
      const asTests = matches(p.health?.tests, pinId, name);
      const asLint = matches(p.health?.lint, pinId, name);
      if (!asTests && !asLint) {
        continue;
      }
      const rec: RunRecord = { name, outcome: res.outcome, exitCode: res.exitCode, endedAt: res.endedAt };
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
  }
}

export function startHealthRecorder(context: vscode.ExtensionContext, store: ShortcutStore, loadConfig: () => Promise<BoardConfig>): void {
  context.subscriptions.push(runStatusRegistry.onDidChange(() => void record(context, store, loadConfig).catch(() => undefined)));
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
export async function collectHealth(context: vscode.ExtensionContext, cfg: BoardConfig, now = Date.now()): Promise<Record<string, ProjectHealth>> {
  const file = await readHealthFile(context.storageUri ?? context.globalStorageUri);
  const out: Record<string, ProjectHealth> = {};
  for (const p of cfg.projects) {
    const lints = await readLints(p.path, p.health?.lintFile ?? DEFAULT_LINT_FILE);
    const runs: RecordedRuns | undefined = file.projects[p.id];
    out[p.id] = evaluateHealth(p.health, runs, lints, now);
  }
  return out;
}

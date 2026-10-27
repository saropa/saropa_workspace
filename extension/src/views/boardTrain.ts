import * as vscode from "vscode";
import { BoardModel } from "../board/boardModel";
import { Train, TrainNaming, asTrainNaming, buildTrains, parseVersion } from "../board/train";
import { BoardConfig } from "../board/types";

// Release train, host side: the two settings and the project versions. A version is read
// from the project's package.json or pubspec.yaml in the background and cached, so the
// board never waits on it; a repaint is asked for when a new version arrives. Read-only.

const SETTINGS = "saropaWorkspace.releaseBoard.train";
const MAX_BYTES = 256 * 1024;
const REFRESH_MS = 60_000;
const FILES = ["package.json", "pubspec.yaml"];

// Undefined when the train is switched off.
export function readTrainSettings(): { naming: TrainNaming } | undefined {
  const c = vscode.workspace.getConfiguration(SETTINGS);
  return c.get<boolean>("enabled", true) ? { naming: asTrainNaming(c.get("naming", "version")) } : undefined;
}

const cache = new Map<string, { version?: string; at: number }>();
const loading = new Set<string>();
const changed = new vscode.EventEmitter<void>();
export const onDidChangeTrainVersions = changed.event;

async function readVersion(dir: vscode.Uri): Promise<string | undefined> {
  for (const name of FILES) {
    try {
      const uri = vscode.Uri.joinPath(dir, name);
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_BYTES) {
        continue;
      }
      const v = parseVersion(name, new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
      if (v) {
        return v;
      }
    } catch {
      // No such file: try the next one.
    }
  }
  return undefined;
}

async function load(path: string): Promise<void> {
  loading.add(path);
  try {
    const before = cache.get(path)?.version;
    const version = await readVersion(vscode.Uri.parse(path));
    cache.set(path, { version, at: Date.now() });
    if (version !== before) {
      changed.fire();
    }
  } finally {
    loading.delete(path);
  }
}

function folderOf(path: string): string {
  const parts = vscode.Uri.parse(path).path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// The trains of a published board; empty when the feature is off or fewer than two projects
// exist. Versions not read yet are filled in a moment later by a change event.
export function trainsFor(model: BoardModel, cfg: BoardConfig): Train[] {
  const s = readTrainSettings();
  if (!s || model.projects.length < 2) {
    return [];
  }
  const defs = new Map(cfg.projects.map((p) => [p.id, p]));
  // Forget versions of projects that are gone.
  const paths = new Set(cfg.projects.map((p) => p.path));
  for (const k of [...cache.keys()]) {
    if (!paths.has(k)) {
      cache.delete(k);
    }
  }
  const input = model.projects.map((p) => {
    const def = defs.get(p.id);
    const hit = def ? cache.get(def.path) : undefined;
    if (def && s.naming === "version" && !loading.has(def.path) && (!hit || Date.now() - hit.at > REFRESH_MS)) {
      void load(def.path);
    }
    return { id: p.id, name: p.name, light: p.light, dependsOn: p.dependsOn, folder: def ? folderOf(def.path) : p.id, version: hit?.version };
  });
  return buildTrains(input, s.naming);
}

export function disposeTrain(): void {
  changed.dispose();
}

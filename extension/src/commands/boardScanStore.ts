import * as vscode from "vscode";
import { ScanResult, ScanSnapshot } from "../board/scanner";
import { SafetyResult } from "../board/safety";
import { ProjectHealth } from "../board/health";
import { MarksFile } from "../board/marks";
import { BoardConfig } from "../board/types";
import { readMarks } from "./boardMarks";
import { boardReady, loadConfig } from "./boardConfigLoad";

// Release Board, stored scans. The accepted baseline and the last shown board live in the
// workspace's own extension storage (never in a document), so another workspace can never
// see or overwrite them.

const CACHE_FILE = "release-board-accepted.json";
const LAST_FILE = "release-board-last.json";

// One scan with everything the board needs to draw it.
export interface BoardRun {
  cfg: BoardConfig;
  result: ScanResult;
  safety: SafetyResult;
  dir: vscode.Uri;
  // The scan is the accepted baseline (clean, or the user accepted it).
  accepted: boolean;
  // The last accepted scan this run was compared with.
  previous?: ScanSnapshot;
  health: Record<string, ProjectHealth>;
  // Hand marks, shared file under local ones.
  marks: MarksFile;
}

// What the board last showed, kept so the next open paints at once while a fresh scan runs.
interface LastRun {
  version: 1;
  rows: ScanResult["rows"];
  snapshot: ScanSnapshot;
  accepted: boolean;
  safety: SafetyResult;
  health: Record<string, ProjectHealth>;
}

// The accepted baseline, or undefined when none is stored or it cannot be read.
export async function readAccepted(dir: vscode.Uri): Promise<ScanSnapshot | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, CACHE_FILE));
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as ScanSnapshot;
  } catch {
    return undefined;
  }
}

// Stores a scan as the accepted baseline.
export async function writeAccepted(dir: vscode.Uri, snap: ScanSnapshot): Promise<void> {
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, CACHE_FILE),
    Buffer.from(JSON.stringify(snap), "utf8")
  );
}

// Stores what the board shows now, for the next first paint.
export async function writeLast(dir: vscode.Uri, run: BoardRun): Promise<void> {
  const last: LastRun = { version: 1, rows: run.result.rows, snapshot: run.result.snapshot, accepted: run.accepted, safety: run.safety, health: run.health };
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, LAST_FILE), Buffer.from(JSON.stringify(last), "utf8"));
}

// The last shown board, or undefined. It is only a first paint: the caller must mark it as
// not yet refreshed and scan again.
export async function readLastRun(context: vscode.ExtensionContext): Promise<BoardRun | undefined> {
  if (!boardReady(true)) {
    return undefined;
  }
  try {
    const dir = context.storageUri ?? context.globalStorageUri;
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, LAST_FILE));
    const last = JSON.parse(Buffer.from(bytes).toString("utf8")) as LastRun;
    if (last.version !== 1) {
      return undefined;
    }
    const cfg = await loadConfig();
    // Only if the same projects are configured; otherwise the old rows mean nothing.
    if (cfg.projects.some((p) => !last.snapshot.projects[p.id])) {
      return undefined;
    }
    const result: ScanResult = { rows: last.rows, snapshot: last.snapshot, pending: [], stats: { files: last.rows.length, headReads: 0, factReads: 0, ms: 0 } };
    // The accepted scan the result was compared with, so a stored paint is never greener than the real one.
    return { cfg, result, safety: last.safety, dir, accepted: last.accepted, previous: await readAccepted(dir), health: last.health, marks: await readMarks(context) };
  } catch {
    return undefined;
  }
}

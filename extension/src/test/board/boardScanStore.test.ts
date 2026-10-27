// Stored scans: the accepted baseline and the last shown board round-trip through the
// workspace's own storage, and a stale paint is never offered.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ScanSnapshot } from "../../board/scanner";
import { Classified } from "../../board/types";
import { BoardRun, readAccepted, readLastRun, writeAccepted, writeLast } from "../../commands/boardScanStore";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

function snapshot(takenAt: number, ...ids: string[]): ScanSnapshot {
  return { version: 1, takenAt, projects: Object.fromEntries(ids.map((id) => [id, {}])) } as unknown as ScanSnapshot;
}

function runWith(dir: vscode.Uri, snap: ScanSnapshot, rows: Classified[] = []): BoardRun {
  return {
    cfg: { version: 1, ignore: [], ruleSets: {}, projects: [] },
    result: { rows, snapshot: snap, pending: [], stats: { files: rows.length, headReads: 0, factReads: 0, ms: 0 } },
    safety: { baseline: false, findings: [], clean: true },
    dir,
    accepted: true,
    health: {},
    marks: { version: 1, marks: {}, needs: {}, rejected: [] },
  };
}

test("nothing is accepted before a scan is stored, and a stored one comes back", async () => {
  const dir = vscode.Uri.file(tmpDir());
  assert.equal(await readAccepted(dir), undefined);
  await writeAccepted(dir, snapshot(7, "app"));
  assert.equal((await readAccepted(dir))?.takenAt, 7);
});

test("a damaged baseline file reads as none", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "release-board-accepted.json"), "{ nope");
  assert.equal(await readAccepted(vscode.Uri.file(dir)), undefined);
});

test("the last board paints again when the same projects are configured", async () => {
  const work = tmpDir();
  const store = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(work), name: "app", index: 0 }]);
  const ctx = contextIn(store);
  const row: Classified = { project: "app", path: "bugs/a.md", status: "red", kind: "", note: "" };
  await writeAccepted(ctx.storageUri!, snapshot(1, "app"));
  await writeLast(ctx.storageUri!, runWith(ctx.storageUri!, snapshot(2, "app"), [row]));
  const last = await readLastRun(ctx);
  assert.deepEqual(last?.result.rows, [row]);
  assert.equal(last?.previous?.takenAt, 1);
  assert.equal(last?.accepted, true);
  assert.equal(last?.result.stats.files, 1);
});

test("a stored board for other projects is not used", async () => {
  const store = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(tmpDir()), name: "app", index: 0 }]);
  const ctx = contextIn(store);
  await writeLast(ctx.storageUri!, runWith(ctx.storageUri!, snapshot(2, "other")));
  assert.equal(await readLastRun(ctx), undefined);
});

test("a stored board of another format, or with the board off, is not used", async () => {
  const store = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(tmpDir()), name: "app", index: 0 }]);
  const ctx = contextIn(store);
  fs.writeFileSync(path.join(store, "release-board-last.json"), JSON.stringify({ version: 2 }));
  assert.equal(await readLastRun(ctx), undefined);
  await writeLast(ctx.storageUri!, runWith(ctx.storageUri!, snapshot(2, "app")));
  assert.ok(await readLastRun(ctx));
  stub.__setConfig("saropaWorkspace.releaseBoard", "enabled", false);
  assert.equal(await readLastRun(ctx), undefined);
});

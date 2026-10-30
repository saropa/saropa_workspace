// Link proposals on the board: the list from the engine, the shared review list, accepting with one
// Undo, rejecting (remembered), loops, documents that read no Needs lines, and the 2,000-document budget.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import defaultRules from "../../board/defaultRules.json";
import { BoardModel, buildBoard } from "../../board/boardModel";
import { resetOrgCache } from "../../board/boardOrg";
import { proposalsPill } from "../../board/boardHtmlHandoff";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, Classified } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { applyRows, undoBatch } from "../../commands/boardPatch";
import { BoardPatches } from "../../views/boardPatches";
import { bestMs } from "./org/orgFixtures";
import { stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  (vscode as unknown as { __resetHosts(): void }).__resetHosts();
  stub.__setWorkspaceFolders(undefined);
});

const TEXT: Record<string, string> = {
  "docs/plan_phase1.md": "# Plan phase 1\n",
  "docs/plan_phase2.md": "# Plan phase 2\n",
  "docs/launch.md": "# Launch\n\nThis is blocked by docs/plan_phase2.md.\n",
  "docs/schema_phase1.sql": "-- Schema phase 1\n",
  "docs/schema_phase2.sql": "-- Schema phase 2\n",
};
const snapshotOf = (texts: Record<string, string>): ScanSnapshot =>
  ({ version: 1, takenAt: 0, projects: { app: { counts: {}, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(Object.entries(texts).map(([p, t]) => [p, { mtimeMs: 100_000, size: t.length, facts: readFacts(t, p) }])) } } }) as unknown as ScanSnapshot;
const rowsOf = (texts: Record<string, string>): Classified[] => Object.keys(texts).map((p) => ({ project: "app", path: p, status: "amber", kind: "owner action", note: "" }));
const pairs = (m: BoardModel): string[] => m.proposals.map((p) => `${p.item}->${p.on}`).sort();

function setup(extra: Parameters<typeof buildBoard>[7] = {}): { dir: string; run: BoardRun; model: BoardModel } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  fs.mkdirSync(path.join(dir, "docs"));
  for (const [p, t] of Object.entries(TEXT)) {
    fs.writeFileSync(path.join(dir, p), t);
  }
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: vscode.Uri.file(dir).toString(), roots: [], ruleSets: [] }] };
  const rows = rowsOf(TEXT);
  resetOrgCache();
  const model = buildBoard(cfg, rows, undefined, true, snapshotOf(TEXT), undefined, {}, extra);
  return { dir, run: { cfg, result: { rows } } as unknown as BoardRun, model };
}

test("the board proposes links from names and wording, with a reason and a confidence, and never for .sql", () => {
  const { model } = setup();
  assert.deepEqual(pairs(model), ["app:docs/launch.md->app:docs/plan_phase2.md", "app:docs/plan_phase2.md->app:docs/plan_phase1.md"]);
  const phrase = model.proposals.find((p) => p.item.endsWith("launch.md"))!;
  assert.equal(phrase.confidence, "high");
  assert.match(phrase.why, /blocked by/);
  assert.ok(model.proposals.every((p) => !p.item.endsWith(".sql") && !p.on.endsWith(".sql")));
});

test("a rejected proposal, an existing link and a loop are not proposed", () => {
  const key = "app/docs/plan_phase2.md->app/docs/plan_phase1.md";
  assert.deepEqual(pairs(setup({ rejected: [key] }).model), ["app:docs/launch.md->app:docs/plan_phase2.md"]);
  assert.deepEqual(pairs(setup({ needs: { "app/docs/launch.md": ["docs/plan_phase2.md"] } }).model), ["app:docs/plan_phase2.md->app:docs/plan_phase1.md"]);
  // Phase 1 already waits on phase 2, so "phase 2 waits on phase 1" would close a circle.
  assert.deepEqual(pairs(setup({ needs: { "app/docs/plan_phase1.md": ["docs/plan_phase2.md"] } }).model), ["app:docs/launch.md->app:docs/plan_phase2.md"]);
});

test("the review list shows proposals unticked, and a tick writes a Needs line with one Undo", async () => {
  const { dir, run, model } = setup();
  const posted: Array<{ type: string; rows: Array<{ i: number; unticked: boolean; conf: string; reason: string; item: string }> }> = [];
  const patches = new BoardPatches(() => ({ model, run }), (m) => posted.push(m as never), () => undefined);
  patches.readLinks();
  assert.equal(posted[0].type, "patchReview");
  assert.equal(posted[0].rows.length, 2);
  assert.ok(posted[0].rows.every((r) => r.unticked && r.conf && r.reason));
  const before = fs.readFileSync(path.join(dir, "docs/launch.md"), "utf8");
  const i = posted[0].rows.find((r) => r.item === "Launch")!.i;
  const picked = patches.pick([i, i, 99]);
  assert.equal(picked?.source, "links");
  assert.equal(picked?.rows.length, 1);
  const out = await applyRows(run, model, picked!.rows);
  assert.equal(out.applied, 1);
  assert.match(fs.readFileSync(path.join(dir, "docs/launch.md"), "utf8"), /^# Launch\n\nNeeds: docs\/plan_phase2\.md\n/);
  assert.equal(fs.readFileSync(path.join(dir, "docs/plan_phase2.md"), "utf8"), TEXT["docs/plan_phase2.md"], "an unticked proposal writes nothing");
  assert.equal(await undoBatch(out.snapshot), true);
  assert.equal(fs.readFileSync(path.join(dir, "docs/launch.md"), "utf8"), before);
});

test("nothing is picked from an unopened list, and rejecting names the keys to remember", () => {
  const { run, model } = setup();
  const patches = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined);
  assert.equal(patches.pick([0]), undefined);
  assert.deepEqual(patches.proposalKeys(), []);
  patches.readLinks();
  assert.deepEqual(patches.proposalKeys().sort(), model.proposals.map((p) => p.key).sort());
  patches.clear();
  assert.deepEqual(patches.proposalKeys(), []);
});

test("a proposal the board no longer offers is dropped at apply time", () => {
  const { run, model } = setup();
  let now = model;
  const patches = new BoardPatches(() => ({ model: now, run }), () => undefined, () => undefined);
  patches.readLinks();
  now = buildBoard(run.cfg, rowsOf(TEXT), undefined, true, snapshotOf(TEXT), undefined, {}, { rejected: model.proposals.map((p) => p.key) });
  const picked = patches.pick([0, 1]);
  assert.deepEqual([picked?.rows.length, picked?.dropped], [0, 2]);
});

test("the pill shows the count and is left out when there is nothing to review", () => {
  const labels = { proposals: "Proposed links {count}", proposalsTip: "tip" };
  assert.equal(proposalsPill({ handoffLabels: labels } as never, 0), "");
  const html = proposalsPill({ handoffLabels: labels } as never, 3);
  assert.match(html, /data-linksopen/);
  assert.ok(html.includes(">Proposed links 3<"));
});

test("2,000 documents are proposed over within the budget, and a repaint reuses the answer", () => {
  const texts = Object.fromEntries(Array.from({ length: 2000 }, (_v, k) => [`docs/area${k % 40}/item${Math.floor(k / 200)}_phase${(Math.floor(k / 40) % 5) + 1}.md`, `# Item ${k}\n\nSee other${k}.md.\n`]));
  const rows = rowsOf(texts);
  const snap = snapshotOf(texts);
  const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const cold = bestMs(() => {
    resetOrgCache();
    buildBoard(cfg, rows, undefined, true, snap);
  }, 1);
  assert.ok(cold < 1500, `took ${cold.toFixed(0)} ms`);
  const m = buildBoard(cfg, rows, undefined, true, snap);
  assert.ok(m.proposals.length > 0 && m.proposals.length <= 200);
  const warm = bestMs(() => void buildBoard(cfg, rows, undefined, true, snap), 1);
  assert.ok(warm < cold, `cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms`);
});

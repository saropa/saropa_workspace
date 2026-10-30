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
import { MAX_REJECTED, addRejected, parseMarks } from "../../board/marks";
import { PatchTarget } from "../../board/patch";
import { buildProposals, proposalRows, resetProposalCache } from "../../board/boardProposals";
import { proposalCounts } from "../../board/boardHtmlHandoff";
import { changedOnDisk } from "../../commands/boardPatch";
import { withoutLinkText } from "../../board/scanner";
import { inferLinkProposals } from "../../board/org/linksInfer";
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
  const posted: Array<{ type: string; rows: Array<{ i: number; key: string; conf: string; reason: string; item: string }> }> = [];
  const patches = new BoardPatches(() => ({ model, run }), (m) => posted.push(m as never), () => undefined);
  patches.readLinks();
  assert.equal(posted[0].type, "patchReview");
  assert.equal(posted[0].rows.length, 2);
  assert.ok(posted[0].rows.every((r) => r.key && r.conf && r.reason));
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

test("rejecting remembers only the unticked rows, and one row can be rejected alone", () => {
  const { run, model } = setup();
  const patches = new BoardPatches(() => ({ model, run }), () => undefined, () => undefined);
  assert.equal(patches.pick([0]), undefined);
  assert.deepEqual(patches.rejectedKeys([]), []);
  assert.equal(patches.rejectedKey(0), undefined);
  patches.readLinks();
  assert.deepEqual(patches.rejectedKeys([]).sort(), model.proposals.map((p) => p.key).sort());
  assert.deepEqual(patches.rejectedKeys([0, 1]), [], "everything ticked: nothing is remembered");
  assert.deepEqual(patches.rejectedKeys([0]), [patches.rejectedKey(1)], "only the unticked row is remembered");
  assert.equal(patches.rejectedKey(99), undefined);
  patches.clear();
  patches.clear();
  assert.equal(patches.rejectedKey(0), patches.rejectedKey(0));
});

test("the rejected list drops the oldest keys at the cap, never the newest", () => {
  const old = Array.from({ length: MAX_REJECTED }, (_v, k) => `app/a${k}.md->app/b${k}.md`);
  const next = addRejected(old, ["app/new.md->app/other.md"]);
  assert.equal(next.length, MAX_REJECTED);
  assert.equal(next[next.length - 1], "app/new.md->app/other.md");
  assert.ok(!next.includes(old[0]) && next.includes(old[1]));
  // A key rejected again moves to the newest end instead of being counted twice.
  assert.deepEqual(addRejected(["a", "b", "c"], ["a"]), ["b", "c", "a"]);
  // Reading a file over the cap keeps the newest too.
  const read = parseMarks(JSON.stringify({ version: 1, rejected: [...old, "app/new.md->app/other.md"] }));
  assert.equal(read.rejected.length, MAX_REJECTED);
  assert.equal(read.rejected[read.rejected.length - 1], "app/new.md->app/other.md");
});

test("a same-length edit of a document changes the proposals (the cache is keyed by content, not length)", () => {
  const cfg = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] } as BoardConfig;
  const build = (texts: Record<string, string>) => {
    const { model } = setup();
    return { items: model.items, snap: snapshotOf(texts) };
  };
  const a = build({ ...TEXT, "docs/launch.md": "# Launch\n\nBlocked by docs/plan_phase2.md." });
  const b = build({ ...TEXT, "docs/launch.md": "# Launch\n\nBlocked by docs/plan_phase1.md." });
  resetProposalCache();
  const first = buildProposals(a.items, a.snap, cfg, [], undefined, new Set()).filter((p) => p.item.endsWith("launch.md")).map((p) => p.on);
  const second = buildProposals(b.items, b.snap, cfg, [], undefined, new Set()).filter((p) => p.item.endsWith("launch.md")).map((p) => p.on);
  assert.notDeepEqual(first, second, "PLAN_A to PLAN_B with the same length gives different proposals");
  assert.ok(first.some((o) => o.endsWith("plan_phase2.md")) && second.some((o) => o.endsWith("plan_phase1.md")));
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

const target = (path: string, rev = "1-1"): PatchTarget => ({ id: `app:${path}`, title: path, project: "app", path, ...(rev ? { rev } : {}), status: "amber", needs: [] });
const view = (item: string, on: string): never => ({ key: `app/${item}->app/${on}`, item: `app:${item}`, on: `app:${on}`, confidence: "high", why: "Phase order." }) as never;

test("a proposal runs the same checks as an AI change: unsafe text, circle, linked, .sql and unread documents are skipped with a reason", () => {
  const t = new Map([
    ["docs/a.md", target("docs/a.md")],
    ["docs/b c.md", target("docs/b c.md")],
    ["docs/d.md", { ...target("docs/d.md"), needs: ["app:docs/a.md"] }],
    ["docs/e.sql", target("docs/e.sql")],
    ["docs/f.md", target("docs/f.md", "")],
    ["docs/ok.md", target("docs/ok.md")],
  ].map(([k, v]) => [`app:${k as string}`, v as PatchTarget]));
  const { rows, skipped } = proposalRows([view("docs/a.md", "docs/b c.md"), view("docs/a.md", "docs/d.md"), view("docs/a.md", "docs/ok.md"), view("docs/e.sql", "docs/a.md"), view("docs/f.md", "docs/a.md"), view("docs/a.md", "docs/missing.md")], t);
  assert.deepEqual(rows.map((r) => r.change.on), ["app:docs/ok.md"]);
  assert.equal(skipped.length, 4, "the one the board does not show is left out silently");
  assert.ok(skipped.every((x) => x.text.length > 0 && x.key.startsWith("app/")));
  assert.match(skipped.map((x) => x.text).join("\n"), /unsafe|circle|sql|read/);
});

const withDocs = (texts: Record<string, string>, early?: Record<string, number>) => Object.entries(texts).map(([path, text]) => ({ project: "app", path, title: path, text, ...(early?.[path] ? { early: early[path] } : {}) }));

test("a mention is Medium in the early lines and Low after, and two documents naming each other give one entry", () => {
  const docs = withDocs({ "docs/a.md": "See docs/b.md.\nSee docs/c.md.", "docs/b.md": "x", "docs/c.md": "y" }, { "docs/a.md": 1 });
  const out = inferLinkProposals(docs, [], new Set());
  assert.deepEqual(out.map((p) => [p.toPath, p.confidence]).sort(), [["docs/b.md", "medium"], ["docs/c.md", "low"]]);
  const mutual = inferLinkProposals(withDocs({ "docs/a.md": "Blocked by docs/b.md.", "docs/b.md": "See docs/a.md." }), [], new Set());
  assert.deepEqual(mutual.map((p) => [p.fromPath, p.toPath, p.signal]), [["docs/a.md", "docs/b.md", "phrase"]], "the weaker direction is dropped");
  const tie = inferLinkProposals(withDocs({ "docs/a.md": "See docs/b.md.", "docs/b.md": "See docs/a.md." }), [], new Set());
  assert.equal(tie.length, 1);
});

test("only High and Medium are counted; Low ones sit behind a toggle, default hidden", () => {
  const p = [{ confidence: "high" }, { confidence: "low" }, { confidence: "low" }, { confidence: "medium" }];
  assert.deepEqual(proposalCounts(p), { main: 2, low: 2 });
  assert.deepEqual(proposalCounts([{ confidence: "low" }]), { main: 0, low: 1 });
  const { run, model } = setup();
  const lows = { ...model, proposals: [...model.proposals, { key: "app/docs/launch.md->app/docs/plan_phase1.md", item: "app:docs/launch.md", on: "app:docs/plan_phase1.md", confidence: "low", why: "Weak." }], rejectedCount: 3 } as BoardModel;
  const posted: Array<{ rows: unknown[]; links: { low: number; lowOn: boolean; undo: number; shared: number } }> = [];
  const patches = new BoardPatches(() => ({ model: lows, run }), (m) => posted.push(m as never), () => undefined);
  patches.readLinks();
  assert.deepEqual([posted[0].rows.length, posted[0].links], [2, { low: 1, lowOn: false, undo: 0, shared: 0 }]);
  patches.readLinks(true);
  assert.deepEqual([posted[1].rows.length, posted[1].links.lowOn], [3, true]);
  patches.lastRejected = ["a", "b"];
  patches.reshowLinks();
  assert.equal(posted[2].links.undo, 2, "Undo reject counts only what the last Reject added");
  assert.equal(posted[2].rows.length, 3, "a list redrawn after a repaint keeps its Low setting");
});

test("a pair the dashed suggestions show is not proposed twice when it is weak, and a stronger one replaces the dashed", () => {
  const offered = new Set(["app/docs/launch.md->app/docs/plan_phase2.md", "app/docs/plan_phase2.md->app/docs/plan_phase1.md"]);
  const { model } = setup();
  const items = model.items;
  const snap = snapshotOf(TEXT);
  const cfg = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] } as BoardConfig;
  resetProposalCache();
  // Both pairs are High (a phrase and a sequence): they stay proposals whatever the dashed layer shows.
  assert.equal(buildProposals(items, snap, cfg, [], undefined, offered).length, 2);
  assert.deepEqual(model.suggestions.filter((s) => model.proposals.some((p) => p.key === s.key)), [], "no pair is both a proposal and a dashed suggestion");
  // The answer is reused for the same inputs and rebuilt when a rejection changes.
  assert.equal(buildProposals(items, snap, cfg, [], undefined, offered), buildProposals(items, snap, cfg, [], undefined, offered));
  assert.equal(buildProposals(items, snap, cfg, [], ["app/docs/launch.md->app/docs/plan_phase2.md"], offered).length, 1);
});

test("a document changed on disk since the scan is found at apply time", async () => {
  const { dir, run, model } = setup();
  const targets = new Map(model.items.map((it) => [`${it.project}:${it.path}`, { id: `${it.project}:${it.path}`, title: it.title, project: it.project, path: it.path, ...(it.rev ? { rev: it.rev } : {}), status: it.status, needs: [] }]));
  const rows = proposalRows(model.proposals, targets).rows;
  // The scan stamped the documents with a made-up time, so every row reads as changed.
  assert.equal((await changedOnDisk(run, targets, rows)).size, 2);
  const st = fs.statSync(path.join(dir, "docs/launch.md"));
  const truthful = new Map([...targets].map(([k, v]) => [k, { ...v, rev: `${Math.floor(fs.statSync(path.join(dir, v.path)).mtimeMs / 1000)}-${fs.statSync(path.join(dir, v.path)).size}` }]));
  assert.equal((await changedOnDisk(run, truthful, rows)).size, 0);
  fs.appendFileSync(path.join(dir, "docs/launch.md"), "edited\n");
  assert.deepEqual([...(await changedOnDisk(run, truthful, rows))], ["app:docs/launch.md"]);
  assert.ok(st.size > 0);
});

test("the link text is capped, and left out of the stored snapshot", () => {
  const long = Array.from({ length: 300 }, (_v, k) => `Blocked by docs/plan_phase${k}.md and a long tail of words to pad the line out ${"x".repeat(80)}`).join("\n");
  const f = readFacts(`# T\n${long}\n`, "docs/t.md");
  assert.ok(f.linkText!.split("\n").length <= 40 && f.linkText!.length <= 4000);
  assert.equal(f.linkEarly, 19, "lines within the first 20 lines are counted as early");
  const snap = snapshotOf({ "docs/t.md": `# T\n${long}\n`, "docs/u.md": "# U\nNo links.\n" });
  const out = withoutLinkText(snap);
  const facts = out.projects.app.facts;
  assert.equal(facts["docs/t.md"].facts.linkText, undefined);
  assert.equal(facts["docs/t.md"].linkless, true);
  assert.equal(facts["docs/u.md"].linkless, undefined);
  assert.ok(!JSON.stringify(out).includes("Blocked by"));
  assert.ok(snap.projects.app.facts["docs/t.md"].facts.linkText, "the live snapshot keeps its text");
});

// 2,000 documents: the engine alone, cold and warm; limits and results only, no wall-clock budget.
for (const lines of [3, 40]) {
  test(`2,000 documents of ${lines} lines are proposed over`, () => {
    const name = (k: number): string => `docs/area${k % 40}/item${Math.floor(k / 200)}_phase${(Math.floor(k / 40) % 5) + 1}.md`;
    const texts = Object.fromEntries(Array.from({ length: 2000 }, (_v, k) => [name(k), ["# Item " + k, ...Array.from({ length: lines }, (_w, i) => (i % 3 === 0 ? `Blocked by ${name((k * 7 + i) % 2000)} and see other${k}.md.` : i % 3 === 1 ? `See ${name((k * 13 + i) % 2000)} for details ${i}.` : `Plain prose line ${i} that matches nothing in particular.`))].join("\n")]));
    const rows = rowsOf(texts);
    const snap = snapshotOf(texts);
    const cfg: BoardConfig = { ...(defaultRules as unknown as BoardConfig), projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
    const items = buildBoard(cfg, rows, undefined, true, snap).items;
    resetProposalCache();
    const found = buildProposals(items, snap, cfg, [], undefined, new Set());
    assert.ok(found.length > 0 && found.length <= 200);
    assert.deepEqual(buildProposals(items, snap, cfg, [], undefined, new Set()), found, "a warm run gives the same result");
  });
}

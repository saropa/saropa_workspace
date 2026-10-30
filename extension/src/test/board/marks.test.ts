// Hand marks, shared marks and suggested links.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BYTES, MAX_REJECTED, type MarksFile, addRejected, applyMarks, emptyMarks, fitMarks, markKey, mergeMarks, parseMarks, pinnedKeys, setMark } from "../../board/marks";
import { inferLinks } from "../../board/inferred";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, Classified, emptyCounts } from "../../board/types";

const row = (path: string, status: Classified["status"] = "amber", project = "app"): Classified => ({ project, path, status, kind: "", note: "" });

test("in progress turns open documents purple and leaves finished ones alone", () => {
  const marks = setMark(setMark(emptyMarks(), markKey("app", "docs/A.md"), { inProgress: true }), markKey("app", "docs/G.md"), { inProgress: true });
  const out = applyMarks([row("docs/A.md"), row("docs/G.md", "green"), row("docs/B.md")], marks);
  assert.deepEqual(out.map((r) => r.status), ["purple", "green", "amber"]);
});

test("a mark with nothing set is removed; pins are listed", () => {
  let m = setMark(emptyMarks(), "app/a.md", { pinned: true, inProgress: true });
  assert.deepEqual(pinnedKeys(m), ["app/a.md"]);
  m = setMark(m, "app/a.md", { pinned: false, inProgress: false });
  assert.deepEqual(m.marks, {});
});

test("shared marks sit under local ones; needs and rejections add up; damaged files are empty", () => {
  const shared = parseMarks(JSON.stringify({ version: 1, marks: { "app/a.md": { pinned: true } }, needs: { "app/x.md": ["app:y.md"] }, rejected: ["k1"] }));
  const local = parseMarks(JSON.stringify({ marks: { "app/b.md": { inProgress: true } }, needs: { "app/x.md": ["app:z.md"] }, rejected: ["k2"] }));
  const m = mergeMarks(shared, local);
  assert.deepEqual(Object.keys(m.marks).sort(), ["app/a.md", "app/b.md"]);
  assert.deepEqual(m.needs["app/x.md"], ["app:y.md", "app:z.md"]);
  assert.deepEqual(m.rejected.sort(), ["k1", "k2"]);
  assert.deepEqual(parseMarks("{broken"), emptyMarks());
  assert.deepEqual(parseMarks(undefined), emptyMarks());
});

test("a document naming exactly one other open document suggests a link; rejected and linked ones do not", () => {
  const items = [
    { project: "app", path: "docs/A.md", refs: ["docs/B.md", "C.md", "../x/missing.md"] },
    { project: "app", path: "docs/B.md", refs: [] },
    { project: "app", path: "docs/C.md", refs: [] },
    { project: "app", path: "other/C.md", refs: [] },
  ];
  const s = inferLinks(items, new Set(), new Set());
  assert.deepEqual(s.map((x) => x.toPath), ["docs/B.md"], "C.md is ambiguous, missing.md matches nothing");
  assert.deepEqual(inferLinks(items, new Set([s[0].key]), new Set()), []);
  assert.deepEqual(inferLinks(items, new Set(), new Set([s[0].key])), []);
});

test("the facts keep the document names, and the board shows the suggestion and honors an accepted link", () => {
  assert.deepEqual(readFacts("# T\nSee docs/B.md and B.md.\n", "docs/A.md").docRefNames, ["B.md", "docs/B.md"]);
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const facts = (p: string, t: string) => ({ size: 1, mtimeMs: 1, facts: readFacts(t, p) });
  const snap: ScanSnapshot = {
    version: 1,
    takenAt: 1,
    projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: { "docs/A.md": facts("docs/A.md", "# A\nSee B.md\n"), "docs/B.md": facts("docs/B.md", "# B\n") } } },
  };
  const rows = [row("docs/A.md"), row("docs/B.md")];
  const m = buildBoard(cfg, rows, undefined, true, snap);
  assert.equal(m.suggestions.length, 1);
  assert.equal(m.suggestions[0].key, "app/docs/A.md->app/docs/B.md");
  const accepted = buildBoard(cfg, rows, undefined, true, snap, undefined, undefined, { needs: { "app/docs/A.md": ["app:docs/B.md"] } });
  assert.equal(accepted.suggestions.length, 0);
  assert.equal(accepted.items.find((i) => i.path === "docs/A.md")!.link?.state, "open");
  assert.equal(buildBoard(cfg, rows, undefined, true, snap, undefined, undefined, { rejected: [m.suggestions[0].key] }).suggestions.length, 0);
});

test("an in-progress mark never lifts a blocker: red stays red, blocked stays collapsed", () => {
  const marks = setMark(setMark(emptyMarks(), "app/bugs/R.md", { inProgress: true }), "app/docs/W.md", { inProgress: true });
  const out = applyMarks([row("bugs/R.md", "red"), { ...row("docs/W.md"), note: "blocked" }], marks);
  assert.deepEqual(out.map((r) => r.status), ["red", "amber"]);
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  assert.equal(buildBoard(cfg, out, undefined, true).projects[0].light, "no-go");
});

test("hand pins are exact documents, not globs", () => {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const rows = [row("docs/A.md"), row("docs/B.md")];
  const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { pins: ["app/**"] });
  assert.ok(m.items.every((i) => !i.pinned));
  const exact = buildBoard(cfg, rows, undefined, true, undefined, undefined, undefined, { pins: ["app/docs/A.md"] });
  assert.deepEqual(exact.items.filter((i) => i.pinned).map((i) => i.path), ["docs/A.md"]);
});

test("a marks file from a repository is bounded and ignores odd keys", () => {
  const m = parseMarks('{"marks":{"__proto__":{"pinned":true},"noslash":{"pinned":true},"app/a.md":{"pinned":true}}}');
  assert.deepEqual(Object.keys(m.marks), ["app/a.md"]);
  assert.equal(({} as Record<string, unknown>).pinned, undefined);
  assert.deepEqual(parseMarks("x".repeat(2_000_000)), emptyMarks());
});

test("a path containing an arrow still yields the right target", () => {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const facts = (p: string, t: string) => ({ size: 1, mtimeMs: 1, facts: readFacts(t, p) });
  const snap: ScanSnapshot = {
    version: 1,
    takenAt: 1,
    projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: { "docs/a.md": facts("docs/a.md", "# A\nsee c.md\n"), "docs/x->y/c.md": facts("docs/x->y/c.md", "# C\n") } } },
  };
  const m = buildBoard(cfg, [row("docs/a.md"), row("docs/x->y/c.md")], undefined, true, snap);
  assert.equal(m.suggestions[0]?.toPath, "docs/x->y/c.md");
  assert.equal(m.suggestions[0]?.fromKey, "app/docs/a.md");
});

test("a key rejected locally again is the newest in the merge, and a full list drops older keys instead", () => {
  const shared = { ...emptyMarks(), rejected: Array.from({ length: MAX_REJECTED }, (_v, k) => `s${k}`) };
  const local = { ...emptyMarks(), rejected: ["s0"] };
  const m = mergeMarks(shared, local);
  assert.equal(m.rejected.length, MAX_REJECTED);
  assert.equal(m.rejected[m.rejected.length - 1], "s0", "moved to the newest end");
  assert.ok(m.rejected.includes("s0") && m.rejected.includes("s1"), "s0 is kept, not dropped as oldest");
  assert.equal(m.sharedRejected, MAX_REJECTED);
});

test("a written marks file never passes the cap: the oldest rejected keys go first, and nothing is dropped when it fits", () => {
  const key = (k: number): string => `project-${k}/docs/some/long/path/name_${k}.md->project-${k}/docs/another/long/path/other_${k}.md`.padEnd(150, "x");
  const small = { ...emptyMarks(), rejected: ["a", "b"] };
  assert.equal(fitMarks(small), small);
  const full = { ...emptyMarks(), rejected: Array.from({ length: MAX_REJECTED }, (_v, k) => key(k)) };
  assert.ok(Buffer.byteLength(JSON.stringify(full)) < MAX_BYTES, "5000 keys of about 150 characters fit on their own");
  // Heavy pins and needs leave less room: the oldest rejected keys are trimmed, the pins and needs are kept.
  const marks: MarksFile["marks"] = {};
  const needs: MarksFile["needs"] = {};
  for (let k = 0; k < 1500; k++) {
    marks[`app/${"d".repeat(150)}${k}.md`] = { pinned: true };
    needs[`app/${"n".repeat(150)}${k}.md`] = [`app:${"t".repeat(100)}${k}.md`];
  }
  const heavy = { ...full, marks, needs };
  assert.ok(Buffer.byteLength(JSON.stringify(heavy)) > MAX_BYTES);
  const fit = fitMarks(heavy)!;
  assert.ok(Buffer.byteLength(JSON.stringify(fit)) <= MAX_BYTES);
  assert.ok(fit.rejected.length > 0 && fit.rejected.length < full.rejected.length);
  assert.deepEqual(fit.rejected, full.rejected.slice(full.rejected.length - fit.rejected.length), "the newest keys stay");
  assert.equal(Object.keys(fit.marks).length, 1500);
  // Pins and needs alone past the cap: refused, never a silent empty file.
  const hopeless = { ...emptyMarks(), marks: Object.fromEntries(Array.from({ length: 20000 }, (_v, k) => [`app/${"p".repeat(100)}${k}`, { pinned: true }])) };
  assert.equal(fitMarks(hopeless), undefined);
});

test("a big marks file keeps what parses, and addRejected keeps the newest", () => {
  const rejected = Array.from({ length: 6000 }, (_v, k) => `k${k}`.padEnd(250, "x"));
  const text = JSON.stringify({ version: 1, marks: { "app/a.md": { pinned: true } }, rejected });
  assert.ok(text.length > MAX_BYTES);
  const read = parseMarks(text);
  assert.deepEqual(Object.keys(read.marks), ["app/a.md"]);
  assert.equal(read.rejected.length, MAX_REJECTED);
  assert.deepEqual(addRejected(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
});

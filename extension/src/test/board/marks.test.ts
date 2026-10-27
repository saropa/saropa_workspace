// Hand marks, shared marks and suggested links.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMarks, emptyMarks, markKey, mergeMarks, parseMarks, pinnedKeys, setMark } from "../../board/marks";
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

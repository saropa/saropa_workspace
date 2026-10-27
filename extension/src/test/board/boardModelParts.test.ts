// Pieces of the board model: keys, titles, the marks rolled up from facts, the one-line
// state of a document's Needs links, the owner rule and the Sittings view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN, factsFor, isOwnerDoc, itemKey, linkSummary, marksOf, sittingsView, titleFromPath, BoardItem } from "../../board/boardModelParts";
import { readFacts } from "../../board/docFacts";
import { Link } from "../../board/links";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, Classified, emptyCounts } from "../../board/types";

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
};

const cls = (path: string, kind = "", status: Classified["status"] = "amber", note = ""): Classified => ({ project: "app", path, status, kind, note });

function snap(files: Record<string, string>): ScanSnapshot {
  const facts = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, { size: 1, mtimeMs: 1, facts: readFacts(text, p) }]));
  return { version: 1, takenAt: 1, projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts } } };
}

test("open work is red, amber and purple", () => {
  assert.deepEqual([...OPEN].sort(), ["amber", "purple", "red"]);
});

test("a key joins project and path with a tab", () => {
  assert.equal(itemKey("app", "docs/a.md"), "app\tdocs/a.md");
});

test("a title is the file name without its extension", () => {
  assert.equal(titleFromPath("docs/plans/PLAN_x.md"), "PLAN_x");
  assert.equal(titleFromPath("a.b.sql"), "a.b");
  assert.equal(titleFromPath("noext"), "noext");
});

test("facts are found by project and path, or are absent", () => {
  const s = snap({ "a.md": "# A\n" });
  assert.equal(factsFor(s, "app", "a.md")?.title, "A");
  assert.equal(factsFor(s, "app", "b.md"), undefined);
  assert.equal(factsFor(s, "other", "a.md"), undefined);
  assert.equal(factsFor(undefined, "app", "a.md"), undefined);
});

test("marks: progress, size, first code language, mentions by name, and the tooltip figures", () => {
  const f = readFacts("# T\n\n- [x] a\n- [ ] b\n\n```sql\nx\n```\n```sql\ny\n```\n```dart\nz\n```\nSee src/a.ts and docs/B.md\n", "t.md", { mentions: { db: "database" } });
  const m = marksOf({ ...f, mentions: ["db", "zz"] }, new Map([["db", "Database"]]));
  assert.equal(m.done, 1);
  assert.equal(m.total, 2);
  assert.equal(m.size, 1);
  assert.equal(m.code, "sql", "the most common language");
  assert.deepEqual(m.mentions, ["Database", "zz"]);
  assert.ok(m.detail.startsWith("1 of 2 steps done; "));
  assert.ok(m.detail.includes("code: 2 sql, 1 dart"));
  assert.ok(m.detail.includes("1 source files named"));
});

test("marks: no checklist and no code", () => {
  const m = marksOf(readFacts("# Plain\n\ntext\n", "p.md"), new Map());
  assert.equal(m.total, 0);
  assert.equal(m.code, undefined);
  assert.ok(m.detail.startsWith("no checklist; "));
  assert.equal(marksOf(readFacts("# C\n```\nx\n```\n", "c.md"), new Map()).code, "", "code with no tag");
});

const link = (target: string, state: Link["state"], toPath?: string): Link => ({ fromProject: "app", fromPath: "a.md", target, state, toProject: toPath ? "app" : undefined, toPath });
const item = (title: string): BoardItem => ({ id: 0, project: "app", path: "b.md", title, status: "amber", kind: "", hub: false, blocksCount: 0, waitsOn: [], pinned: false, stopping: false });

test("link summary: a problem link wins over an open one", () => {
  const s = linkSummary([link("x.md", "missing"), link("b.md", "open", "b.md")], new Map());
  assert.equal(s.state, "flag");
  assert.equal(s.detail, "x.md: missing");
});

test("link summary: open links name the documents waited on", () => {
  const byKey = new Map([[itemKey("app", "b.md"), item("Bee")]]);
  assert.deepEqual(linkSummary([link("b.md", "open", "b.md")], byKey), { state: "open", detail: "Waits on Bee" });
  assert.equal(linkSummary([link("b.md", "open", "docs/untracked.md")], new Map()).detail, "Waits on untracked", "a title from the path when not listed");
});

test("link summary: all finished says the Needs line can go", () => {
  const s = linkSummary([link("b.md", "done", "b.md")], new Map([[itemKey("app", "b.md"), item("Bee")]]));
  assert.equal(s.state, "done");
  assert.ok(s.detail.startsWith("Needs Bee"));
  assert.ok(s.detail.includes("remove the Needs line"));
});

test("owner documents: by kind, by folder name, with both settings ignoring junk", () => {
  assert.equal(isOwnerDoc(cfg, cls("a.md", "owner action")), true);
  assert.equal(isOwnerDoc(cfg, cls("a.md", "bug")), false);
  assert.equal(isOwnerDoc({ ...cfg, ownerKinds: ["check"] }, cls("a.md", "check")), true);
  assert.equal(isOwnerDoc({ ...cfg, ownerKinds: ["check"] }, cls("a.md", "owner action")), false);
  assert.equal(isOwnerDoc({ ...cfg, ownerFolders: ["Human"] }, cls("bugs/human/a.md")), true);
  assert.equal(isOwnerDoc({ ...cfg, ownerFolders: ["human"] }, cls("human.md")), false, "the file name is not a folder");
  assert.equal(isOwnerDoc({ ...cfg, ownerKinds: 5 as never, ownerFolders: "x" as never }, cls("a.md", "owner action")), true);
});

const sel = { have: ["mac"], timeBox: "any" as const, maxSteps: 10 };

test("sittings view: steps that fit come first, then untagged ones, and unknown contexts are dropped", () => {
  const s = snap({ "a.md": "# A\n\n- [ ] Upload with Xcode\n- [ ] Write the notes\n" });
  const v = sittingsView(cfg, [cls("a.md")], s, new Map(), { selection: { ...sel, have: ["mac", "ghost"] }, onlyOwner: false });
  assert.deepEqual(v.have, ["mac"]);
  assert.equal(v.doable, 1);
  assert.equal(v.untagged, 1);
  assert.equal(v.lines.length, 2);
  assert.ok(v.lines[0].text.includes("Xcode"));
  assert.ok(v.contexts.some((c) => c.id === "mac"));
});

test("sittings view: blocked, finished and waiting documents offer no steps", () => {
  const s = snap({ "a.md": "# A\n- [ ] Xcode one\n", "b.md": "# B\n- [ ] Xcode two\n", "c.md": "# C\n- [ ] Xcode three\n", "d.md": "# D\n- [ ] Xcode four\n" });
  const rows = [cls("a.md"), cls("b.md", "", "amber", "blocked"), cls("c.md", "", "green"), cls("d.md")];
  const waiting = new Map([[itemKey("app", "d.md"), { ...item("D"), link: { state: "open" as const, detail: "" } }]]);
  const v = sittingsView(cfg, rows, s, waiting, { selection: sel, onlyOwner: false });
  assert.deepEqual(v.lines.map((l) => l.path), ["a.md"]);
});

test("sittings view: owner-only keeps just the owner's documents", () => {
  const s = snap({ "a.md": "# A\n- [ ] Xcode one\n", "b.md": "# B\n- [ ] Xcode two\n" });
  const rows = [cls("a.md", "owner action"), cls("b.md", "bug")];
  assert.deepEqual(sittingsView(cfg, rows, s, new Map(), { selection: sel, onlyOwner: true }).lines.map((l) => l.path), ["a.md"]);
  assert.equal(sittingsView(cfg, rows, s, new Map(), { selection: sel, onlyOwner: false }).lines.length, 2);
});

test("sittings view: a document whose text was not read has no steps", () => {
  const v = sittingsView(cfg, [cls("a.md")], undefined, new Map(), { selection: sel, onlyOwner: false });
  assert.deepEqual(v.lines, []);
});

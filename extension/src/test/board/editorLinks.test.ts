import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardItem } from "../../board/boardModel";
import { DocFacts } from "../../board/docFacts";
import { asMinSeverity, buildFileIndex, linksForFile, relativeTo, worstColor } from "../../board/editorLinks";

function item(id: number, project: string, title: string, status: BoardItem["status"], severity?: BoardItem["severity"]): BoardItem {
  return { id, project, path: `bugs/${title}.md`, title, status, kind: "", hub: false, blocksCount: 0, waitsOn: [], pinned: false, stopping: false, severity };
}

function facts(sourceFiles: string[], sourceRefs = sourceFiles.length): DocFacts {
  return { sourceFiles, sourceRefs } as DocFacts;
}

const items = [
  item(0, "app", "Backup", "red", "critical"),
  item(1, "app", "Nightly", "amber", "medium"),
  item(2, "db", "Plan", "purple", "low"),
  item(3, "app", "Unread", "red"),
];
const byId: Record<number, DocFacts | undefined> = {
  0: facts(["lib/backup.dart", "lib/Other.dart"]),
  1: facts(["lib/backup.dart"]),
  2: facts(["lib/backup.dart"]),
  3: undefined,
};
const index = buildFileIndex(items, (it) => byId[it.id], false);

test("a file maps to the open documents of its own project, worst first", () => {
  const l = linksForFile(index, "app", "lib/backup.dart", false);
  assert.deepEqual(l.map((x) => x.title), ["Backup", "Nightly"]);
  assert.equal(worstColor(l), "red");
});

test("a project never sees another project's documents", () => {
  assert.deepEqual(linksForFile(index, "db", "lib/backup.dart", false).map((x) => x.title), ["Plan"]);
});

test("unknown file, unread document and empty list give nothing", () => {
  assert.deepEqual(linksForFile(index, "app", "lib/none.dart", false), []);
  assert.equal(worstColor([]), undefined);
});

test("case folding matches only when asked", () => {
  const folded = buildFileIndex(items, (it) => byId[it.id], true);
  assert.equal(linksForFile(folded, "app", "LIB/other.dart", true).length, 1);
  assert.equal(linksForFile(index, "app", "lib/other.dart", false).length, 0);
});

test("purple is worse than amber", () => {
  const l = [{ id: 1, title: "a", status: "amber" as const, capped: false }, { id: 2, title: "b", status: "purple" as const, capped: false }];
  assert.equal(worstColor(l), "purple");
});

test("the minimum severity narrows the list", () => {
  assert.deepEqual(linksForFile(index, "app", "lib/backup.dart", false, "high").map((x) => x.title), ["Backup"]);
  assert.deepEqual(linksForFile(index, "app", "lib/backup.dart", false, "critical").map((x) => x.title), ["Backup"]);
  assert.equal(linksForFile(index, "db", "lib/backup.dart", false, "medium").length, 0);
});

test("a document naming more than the kept files is flagged", () => {
  const idx = buildFileIndex([items[0]], () => facts(["a/x.ts"], 55), false);
  assert.equal(linksForFile(idx, "app", "a/x.ts", false)[0].capped, true);
  assert.equal(linksForFile(index, "app", "lib/backup.dart", false)[0].capped, false);
});

test("relativeTo needs the file to be inside the base", () => {
  assert.equal(relativeTo("/w/app", "/w/app/lib/a.dart", false), "lib/a.dart");
  assert.equal(relativeTo("/w/app/", "/w/app/lib/a.dart", false), "lib/a.dart");
  assert.equal(relativeTo("/w/app", "/w/application/a.dart", false), undefined);
  assert.equal(relativeTo("/w/APP", "/w/app/Lib/a.dart", true), "Lib/a.dart");
  assert.equal(relativeTo("/w/APP", "/w/app/lib/a.dart", false), undefined);
});

test("relativeTo cuts by original length when lowercasing changes length", () => {
  // U+0130 lowercases to two characters.
  assert.equal(relativeTo("/w/\u0130", "/w/\u0130/lib/a.dart", true), "lib/a.dart");
  assert.equal(relativeTo("/w/\u0130x", "/w/\u0130/lib/a.dart", true), undefined);
});

test("minSeverity setting values fall back to any", () => {
  assert.equal(asMinSeverity("high"), "high");
  assert.equal(asMinSeverity("bogus"), "any");
  assert.equal(asMinSeverity(undefined), "any");
});

// Tidy sweep: which documents are listed, the destination, and the folder setting guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TIDY_LIST_CAP, TidyDoc, archiveTarget, buildTidy, cleanArchiveFolder, clampAfterDays } from "../../board/tidy";
import { buildBoard } from "../../board/boardModel";
import { readFacts } from "../../board/docFacts";
import { BoardConfig, Classified } from "../../board/types";
import { ScanSnapshot } from "../../board/scanner";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime();
const doc = (over: Partial<TidyDoc> = {}): TidyDoc => ({
  id: 0,
  project: "app",
  projectName: "App",
  path: "bugs/BUG_A.md",
  title: "A",
  stepsDone: 3,
  stepsTotal: 3,
  mtimeMs: NOW - 10 * DAY,
  pinned: false,
  waiting: false,
  ...over,
});
const opt = { now: NOW, afterDays: 7, archiveFolder: "docs/history" };

test("a finished document untouched for the set days is listed", () => {
  const v = buildTidy([doc()], opt);
  assert.equal(v.candidates.length, 1);
  assert.equal(v.candidates[0].idleDays, 10);
  assert.equal(v.candidates[0].to, "docs/history/2026/2026.10/2026.10.27/BUG_A.md");
});

test("a recent change, an open step, no checklist or no recorded time keeps a document off the list", () => {
  assert.equal(buildTidy([doc({ mtimeMs: NOW - 6 * DAY })], opt).candidates.length, 0);
  assert.equal(buildTidy([doc({ mtimeMs: NOW - 7 * DAY })], opt).candidates.length, 1);
  assert.equal(buildTidy([doc({ stepsDone: 2 })], opt).candidates.length, 0);
  assert.equal(buildTidy([doc({ stepsDone: 0, stepsTotal: 0 })], opt).candidates.length, 0);
  assert.equal(buildTidy([doc({ mtimeMs: undefined })], opt).candidates.length, 0);
});

test("pinned and waiting documents are never offered, nor ones already in the archive", () => {
  assert.equal(buildTidy([doc({ pinned: true })], opt).candidates.length, 0);
  assert.equal(buildTidy([doc({ waiting: true })], opt).candidates.length, 0);
  assert.equal(buildTidy([doc({ path: "docs/history/2026/BUG_A.md" })], opt).candidates.length, 0);
});

test("a time in the future counts as zero idle days", () => {
  assert.equal(buildTidy([doc({ mtimeMs: NOW + DAY })], opt).candidates.length, 0);
});

test("the list is capped, most idle first, and the rest is counted", () => {
  const docs = Array.from({ length: TIDY_LIST_CAP + 3 }, (_, i) => doc({ id: i, path: `bugs/B${i}.md`, mtimeMs: NOW - (10 + i) * DAY }));
  const v = buildTidy(docs, opt);
  assert.equal(v.candidates.length, TIDY_LIST_CAP);
  assert.equal(v.more, 3);
  assert.equal(v.candidates[0].path, `bugs/B${TIDY_LIST_CAP + 2}.md`);
});

test("the archive folder stays inside the project", () => {
  assert.equal(cleanArchiveFolder("docs\\old//done/"), "docs/old/done");
  for (const bad of ["../x", "a/../../b", "/etc", "C:/x", "", "  ", 5, undefined]) {
    assert.equal(cleanArchiveFolder(bad), "docs/history", String(bad));
  }
});

test("the days setting is bounded", () => {
  assert.equal(clampAfterDays(0), 1);
  assert.equal(clampAfterDays(9999), 365);
  assert.equal(clampAfterDays("x"), 7);
  assert.equal(clampAfterDays(14), 14);
});

test("the destination uses the day of the clock, zero padded", () => {
  assert.equal(archiveTarget("a/b/C.md", "h", new Date(2026, 0, 5).getTime()), "h/2026/2026.01/2026.01.05/C.md");
});

test("the board model lists a finished, idle document and leaves the setting off alone", () => {
  const cfg: BoardConfig = {
    version: 1,
    ignore: [],
    ruleSets: {},
    projects: [{ id: "app", name: "App", path: "/p", roots: ["bugs"], ruleSets: [] }],
  };
  const rows: Classified[] = [
    { project: "app", path: "bugs/DONE.md", status: "amber", kind: "bug", note: "" },
    { project: "app", path: "bugs/OPEN.md", status: "amber", kind: "bug", note: "" },
  ];
  const mtimeMs = NOW - 20 * DAY;
  const fact = (text: string) => ({ size: text.length, mtimeMs, facts: readFacts(text, "x.md") });
  const snapshot = {
    version: 1,
    takenAt: NOW,
    projects: {
      app: {
        counts: {},
        folders: {},
        ruleCounts: {},
        greyFolders: {},
        files: { "bugs/DONE.md": { size: 1, mtimeMs, word: "" }, "bugs/OPEN.md": { size: 1, mtimeMs, word: "" } },
        facts: { "bugs/DONE.md": fact("# Done\n- [x] a\n- [x] b\n"), "bugs/OPEN.md": fact("# Open\n- [x] a\n- [ ] b\n") },
      },
    },
  } as unknown as ScanSnapshot;
  const on = buildBoard(cfg, rows, undefined, true, snapshot, undefined, undefined, { tidy: opt });
  assert.deepEqual(on.tidy?.candidates.map((c) => c.path), ["bugs/DONE.md"]);
  assert.equal(on.tidy?.candidates[0].id, on.items.find((i) => i.path === "bugs/DONE.md")?.id);
  assert.equal(buildBoard(cfg, rows, undefined, true, snapshot).tidy, undefined);
});

// Release Board safety check and scan cache. Pure: snapshots are built by hand or by
// scanning an in-memory file source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScan } from "../../board/safety";
import { FileSource, ProjectSnapshot, ScanSnapshot, scanAll } from "../../board/scanner";
import { BoardConfig, ScanFile, emptyCounts } from "../../board/types";

function project(
  counts: Partial<ReturnType<typeof emptyCounts>>,
  folders: Record<string, number>,
  ruleCounts: Record<string, number>
): ProjectSnapshot {
  return {
    counts: { ...emptyCounts(), ...counts },
    folders,
    ruleCounts,
    greyFolders: {},
    files: {},
  };
}

function snap(p: ProjectSnapshot): ScanSnapshot {
  return { version: 1, takenAt: 0, projects: { app: p } };
}

test("first scan is a baseline, never clean", () => {
  const r = checkScan(undefined, snap(project({}, {}, {})));
  assert.equal(r.baseline, true);
  assert.equal(r.clean, false);
});

test("renaming a small folder is caught by the rule and folder checks, not by percent", () => {
  // 10 of 444 documents: 2 percent, below the percent threshold, but the folder is gone.
  const before = snap(project({ blue: 444, green: 4000 }, { "docs/deferred": 10, "docs/history": 4000 }, { "folder-states/deferred": 444 }));
  const after = snap(project({ blue: 434, amber: 10, green: 4000 }, { "docs/parked": 10, "docs/history": 4000 }, { "folder-states/deferred": 434 }));
  const r = checkScan(before, after);
  assert.equal(r.clean, false);
  assert.ok(r.findings.some((f) => f.kind === "folder-gone" && f.text.includes("docs/deferred")));
});

test("a rule that stops matching holds the update", () => {
  const before = snap(project({ blue: 100 }, { "docs/deferred": 100 }, { "folder-states/deferred": 100 }));
  const after = snap(project({ grey: 100 }, { "docs/deferred": 100 }, {}));
  const r = checkScan(before, after);
  assert.ok(r.findings.some((f) => f.kind === "rule-matches-nothing"));
});

test("small count moves do not fire", () => {
  const before = snap(project({ red: 2 }, { bugs: 2 }, { "s/live": 2 }));
  const after = snap(project({ red: 3 }, { bugs: 3 }, { "s/live": 3 }));
  const r = checkScan(before, after);
  assert.equal(r.clean, true);
  assert.equal(r.findings.length, 0);
});

test("a bulk archive is an accepted summary, not a hold", () => {
  const before = snap(project({ amber: 120, green: 100 }, { "docs/plans": 120, "docs/history": 100 }, { "s/plan": 120 }));
  const after = snap(project({ amber: 0, green: 220 }, { "docs/history": 100, "docs/history/2026": 120 }, { "s/plan": 0 }));
  const r = checkScan(before, after);
  assert.ok(r.findings.some((f) => f.kind === "moved-to-done" && f.severity === "info"));
  // The rule going to zero is still reported; only the move explains the folders.
  assert.ok(r.findings.some((f) => f.kind === "rule-matches-nothing"));
});

// In-memory source for the cache test.
function memSource(files: ScanFile[], heads: Record<string, string>, reads: string[]): FileSource {
  return {
    async list(): Promise<ScanFile[]> {
      return files;
    },
    async readHead(_d: string, p: string): Promise<string> {
      reads.push(p);
      return heads[p] ?? "";
    },
  };
}

const cfg: BoardConfig = {
  version: 1,
  ignore: ["**/mocks/**"],
  ruleSets: {
    s: {
      rules: [{ id: "live", when: { path: "bugs/*.md" }, set: { status: "red" } }],
      statusLine: { appliesTo: ["red"], words: { fixed: "green" } },
    },
  },
  projects: [{ id: "p", path: "p", roots: ["bugs"], ruleSets: ["s"] }],
};

test("cache: an unchanged file is not read again; a changed file is", async () => {
  const files: ScanFile[] = [
    { path: "bugs/a.md", size: 10, mtimeMs: 5 },
    { path: "bugs/b.md", size: 10, mtimeMs: 5 },
    { path: "bugs/mocks/c.md", size: 1, mtimeMs: 1 },
  ];
  const heads = { "bugs/a.md": "Status: fixed", "bugs/b.md": "Status: open" };
  const reads1: string[] = [];
  const first = await scanAll(cfg, memSource(files, heads, reads1));
  assert.equal(reads1.length, 2, "two files read, the ignored one skipped");
  assert.equal(first.snapshot.projects.p.counts.green, 1);
  assert.equal(first.snapshot.projects.p.counts.red, 1);

  const reads2: string[] = [];
  const changed = files.map((f) => (f.path === "bugs/b.md" ? { ...f, mtimeMs: 6 } : f));
  const second = await scanAll(cfg, memSource(changed, heads, reads2), first.snapshot);
  assert.deepEqual(reads2, ["bugs/b.md"], "only the changed file is read");
  assert.deepEqual(second.snapshot.projects.p.counts, first.snapshot.projects.p.counts);
});

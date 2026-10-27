// The scanner: listing, classifying, caching by size and time, cached mode with a later
// completion, and the fingerprint. The file source is a small in-memory one so every read
// can be counted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FileSource, ScanSnapshot, completeFacts, scanAll, scanProject, snapshotFingerprint } from "../../board/scanner";
import { BoardConfig, ScanFile } from "../../board/types";

const cfg: BoardConfig = {
  version: 1,
  ignore: ["**/ignored/**"],
  ruleSets: {
    s: {
      rules: [
        { id: "done", when: { path: "**/history/**" }, set: { status: "green" } },
        { id: "live", when: { path: "bugs/*.md" }, set: { status: "red", kind: "bug" } },
      ],
      statusLine: { appliesTo: ["red"], words: { fixed: "green" } },
    },
  },
  projects: [{ id: "p", name: "P", path: "p", roots: ["bugs", "missing"], ruleSets: ["s"] }],
};

interface Mem {
  source: FileSource;
  files: Map<string, { text: string; mtimeMs: number }>;
  reads: { head: number; text: number };
}

function memory(initial: Record<string, string>, opts: { noText?: boolean; failText?: string } = {}): Mem {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, { text: v, mtimeMs: 1000 }]));
  const reads = { head: 0, text: 0 };
  const source: FileSource = {
    async list(_dir, root, accept) {
      if (root === "missing") {
        const e = new Error("gone") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      }
      const out: ScanFile[] = [];
      for (const [p, f] of [...files].reverse()) {
        if (p.startsWith(root + "/") && (!accept || accept(p))) {
          out.push({ path: p, size: f.text.length, mtimeMs: f.mtimeMs });
        }
      }
      return out;
    },
    async readHead(_dir, p, lines) {
      reads.head += 1;
      return files.get(p)!.text.split("\n").slice(0, lines).join("\n");
    },
  };
  if (!opts.noText) {
    source.readText = async (_dir, p) => {
      reads.text += 1;
      if (p === opts.failText) {
        throw new Error("unreadable");
      }
      return files.get(p)!.text;
    };
  }
  return { source, files, reads };
}

const docs = {
  "bugs/b.md": "# Bee\n\n- [ ] first\n- [x] second\n",
  "bugs/a.md": "# Ay\nStatus: Fixed\n",
  "bugs/history/c.md": "# Cee\n",
  "bugs/ignored/d.md": "# Dee\n",
  "bugs/notes.txt": "plain",
};

test("files are listed, ignored files and other extensions are dropped, and rows come in path order", async () => {
  const m = memory(docs);
  const r = await scanAll(cfg, m.source);
  assert.deepEqual(r.rows.map((x) => x.path), ["bugs/a.md", "bugs/b.md", "bugs/history/c.md"]);
  assert.equal(r.stats.files, 3);
});

test("a missing root is empty and does not stop the scan", async () => {
  const r = await scanAll(cfg, memory(docs).source);
  assert.equal(r.rows.length, 3);
});

test("any other listing error surfaces", async () => {
  const m = memory(docs);
  m.source.list = async () => {
    throw new Error("permission denied");
  };
  await assert.rejects(scanAll(cfg, m.source), /permission denied/);
});

test("rows are classified by rule, and a Status line can move a live item", async () => {
  const r = await scanAll(cfg, memory(docs).source);
  const by = Object.fromEntries(r.rows.map((x) => [x.path, x]));
  assert.equal(by["bugs/b.md"].status, "red");
  assert.equal(by["bugs/a.md"].status, "green");
  assert.equal(by["bugs/a.md"].statusWord, "fixed");
  assert.equal(by["bugs/history/c.md"].status, "green");
  const snap = r.snapshot.projects.p;
  assert.equal(snap.counts.red, 1);
  assert.equal(snap.counts.green, 2);
});

test("the snapshot tallies folders at every depth, rules, and grey folders", async () => {
  const r = await scanAll(cfg, memory({ ...docs, "bugs/odd/x.md": "# X\n" }).source);
  const snap = r.snapshot.projects.p;
  assert.deepEqual(snap.folders.bugs, { n: 4, green: 2 });
  assert.deepEqual(snap.folders["bugs/history"], { n: 1, green: 1 });
  assert.equal(snap.ruleCounts["s/done"], 1);
  assert.equal(snap.ruleCounts["s/live"], 2, "a Status line moves the state but the rule still counts");
  assert.deepEqual(snap.greyFolders, { "bugs/odd": 1 }, "no rule placed the file in bugs/odd");
});

test("facts are read for open documents only", async () => {
  const r = await scanAll(cfg, memory(docs).source);
  const snap = r.snapshot.projects.p;
  assert.deepEqual(Object.keys(snap.facts), ["bugs/b.md"]);
  assert.equal(snap.facts["bugs/b.md"].facts.stepsOpen, 1);
  assert.equal(snap.facts["bugs/b.md"].facts.stepsDone, 1);
  assert.equal(r.stats.factReads, 1);
});

test("a source without readText yields no facts and nothing pending", async () => {
  const r = await scanAll(cfg, memory(docs, { noText: true }).source);
  assert.deepEqual(r.snapshot.projects.p.facts, {});
  assert.deepEqual(r.pending, []);
});

test("one unreadable document gives no facts and does not abort the scan", async () => {
  const r = await scanAll(cfg, memory({ ...docs, "bugs/e.md": "# E\n" }, { failText: "bugs/e.md" }).source);
  assert.deepEqual(Object.keys(r.snapshot.projects.p.facts), ["bugs/b.md"]);
  assert.equal(r.rows.length, 4);
});

test("a second scan of unchanged files reads nothing again", async () => {
  const m = memory(docs);
  const first = await scanAll(cfg, m.source);
  const heads = m.reads.head;
  const texts = m.reads.text;
  assert.ok(heads > 0 && texts > 0);
  const second = await scanAll(cfg, m.source, first.snapshot);
  assert.equal(m.reads.head, heads);
  assert.equal(m.reads.text, texts);
  assert.equal(second.stats.headReads, 0);
  assert.equal(second.stats.factReads, 0);
  assert.deepEqual(second.rows, first.rows);
});

test("a changed file is read again; its neighbors are not", async () => {
  const m = memory(docs);
  const first = await scanAll(cfg, m.source);
  const heads = m.reads.head;
  m.files.set("bugs/a.md", { text: "# Ay\nStatus: WIP\n", mtimeMs: 2000 });
  const second = await scanAll(cfg, m.source, first.snapshot);
  assert.equal(m.reads.head - heads, 1);
  assert.equal(second.rows.find((x) => x.path === "bugs/a.md")!.status, "red");
});

test("cached mode lists open documents as pending and completeFacts reads them", async () => {
  const m = memory(docs);
  const first = await scanAll(cfg, m.source);
  const edited = memory(docs);
  edited.files.set("bugs/b.md", { text: "# Bee\n\n- [ ] one\n- [ ] two\n", mtimeMs: 5000 });
  const r = await scanAll(cfg, edited.source, first.snapshot, 10, "cached");
  assert.equal(edited.reads.text, 0, "no body is read in cached mode");
  assert.deepEqual(r.pending.map((p) => p.path), ["bugs/b.md"]);
  assert.deepEqual(r.snapshot.projects.p.facts, {});
  await completeFacts(cfg, edited.source, r);
  assert.deepEqual(r.pending, []);
  assert.equal(r.snapshot.projects.p.facts["bugs/b.md"].facts.stepsOpen, 2);
  assert.equal(r.stats.factReads, 1);
});

test("cached facts are dropped when the reader options change", async () => {
  const m = memory(docs);
  const first = await scanAll(cfg, m.source);
  const texts = m.reads.text;
  const other: BoardConfig = { ...cfg, sourceDirs: ["elsewhere"] };
  await scanAll(other, m.source, first.snapshot);
  assert.equal(m.reads.text, texts + 1, "the open document is read again");
});

test("scanProject returns the same rows as scanAll for one project", async () => {
  const m = memory(docs);
  const one = await scanProject(cfg, cfg.projects[0], m.source);
  const all = await scanAll(cfg, m.source);
  assert.deepEqual(one.rows, all.rows);
  assert.equal(one.headReads, all.stats.headReads);
});

test("the fingerprint is stable for the same scan and changes when a count moves", async () => {
  const m = memory(docs);
  const a: ScanSnapshot = (await scanAll(cfg, m.source)).snapshot;
  const b: ScanSnapshot = (await scanAll(cfg, m.source, a)).snapshot;
  assert.equal(snapshotFingerprint(a), snapshotFingerprint(b));
  m.files.set("bugs/z.md", { text: "# Z\n", mtimeMs: 1 });
  const c = (await scanAll(cfg, m.source, a)).snapshot;
  assert.notEqual(snapshotFingerprint(a), snapshotFingerprint(c));
  assert.notEqual(snapshotFingerprint(a, "x"), snapshotFingerprint(a, "y"), "the extra part counts");
});

// Speed: bounded parallel reads, the two-phase scan and the loading page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "../../board/pool";
import { FileSource, completeFacts, scanAll } from "../../board/scanner";
import { renderSkeleton } from "../../board/boardHtml";
import { BoardConfig, ScanFile } from "../../board/types";

test("mapLimit keeps the order and never exceeds the limit", async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([5, 4, 3, 2, 1, 0], 2, async (n) => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, n));
    live -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [10, 8, 6, 4, 2, 0]);
  assert.ok(peak <= 2);
  assert.deepEqual(await mapLimit([], 4, async (x) => x), []);
});

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: { s: { rules: [{ id: "live", when: { path: "bugs/*.md" }, set: { status: "red" } }] } },
  projects: [{ id: "p", path: "p", roots: ["bugs"], ruleSets: ["s"] }],
} as unknown as BoardConfig;

function source(files: ScanFile[], reads: string[]): FileSource {
  return {
    list: async (_p, _r, accept) => files.filter((f) => !accept || accept(f.path)),
    readHead: async () => "",
    readText: async (_p, path) => {
      reads.push(path);
      return `# Title of ${path}\n`;
    },
  };
}

test("a cached scan leaves facts pending; completing them gives the same result as a full scan", async () => {
  const files: ScanFile[] = [
    { path: "bugs/a.md", size: 5, mtimeMs: 1 },
    { path: "bugs/b.md", size: 5, mtimeMs: 1 },
    { path: "bugs/pic.png", size: 5, mtimeMs: 1 },
  ];
  const reads: string[] = [];
  const first = await scanAll(cfg, source(files, reads), undefined, 1, "cached");
  assert.equal(reads.length, 0, "no document text read before the first paint");
  assert.equal(first.rows.length, 2, "the picture is never listed");
  assert.equal(first.pending.length, 2);
  await completeFacts(cfg, source(files, reads), first);
  assert.equal(first.pending.length, 0);
  const full = await scanAll(cfg, source(files, []), undefined, 1, "all");
  assert.deepEqual(first.snapshot.projects.p.facts, full.snapshot.projects.p.facts);
  // A second pass over unchanged files reads nothing.
  const again: string[] = [];
  const second = await scanAll(cfg, source(files, again), first.snapshot, 2, "all");
  assert.equal(again.length, 0);
  assert.equal(second.stats.factReads, 0);
});

test("the loading page shows placeholders under a strict script policy", () => {
  const t = new Proxy({}, { get: (_o, k: string) => `[${k}]` }) as never;
  const html = renderSkeleton(t, "nonce1");
  assert.ok(html.includes('class="sk'));
  assert.ok(html.includes("script-src 'nonce-nonce1'"));
  assert.ok(html.includes("prefers-reduced-motion"));
});

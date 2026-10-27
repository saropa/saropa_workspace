// The node file source: listing, filtering, head and full reads over a real folder.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { nodeFileSource } from "../../board/nodeSource";

let base = "";

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "board-node-source-"));
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), text);
  };
  put("proj/docs/a.md", "one\ntwo\nthree\nfour\n");
  put("proj/docs/deep/b.md", "bee");
  put("proj/docs/deep/c.txt", "see");
  put("proj/other/d.md", "dee");
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

test("list walks every folder under the root, with / paths relative to the project", async () => {
  const files = await nodeFileSource(base).list("proj", "docs");
  assert.deepEqual(files.map((f) => f.path).sort(), ["docs/a.md", "docs/deep/b.md", "docs/deep/c.txt"]);
});

test("list reports each file's size and modified time", async () => {
  const files = await nodeFileSource(base).list("proj", "docs");
  const b = files.find((f) => f.path === "docs/deep/b.md")!;
  assert.equal(b.size, 3);
  assert.ok(b.mtimeMs > 0);
});

test("list skips the files the accept filter turns down", async () => {
  const seen: string[] = [];
  const files = await nodeFileSource(base).list("proj", "docs", (p) => {
    seen.push(p);
    return p.endsWith(".md");
  });
  assert.deepEqual(files.map((f) => f.path).sort(), ["docs/a.md", "docs/deep/b.md"]);
  assert.ok(seen.includes("docs/deep/c.txt"), "the filter sees the project-relative path");
});

test("a root that does not exist fails with a not-found error", async () => {
  await assert.rejects(nodeFileSource(base).list("proj", "nope"), (e: NodeJS.ErrnoException) => e.code === "ENOENT");
});

test("readHead returns only the first lines", async () => {
  const src = nodeFileSource(base);
  assert.equal(await src.readHead("proj", "docs/a.md", 2), "one\ntwo");
  assert.equal(await src.readHead("proj", "docs/deep/b.md", 5), "bee");
});

test("readText returns the whole file", async () => {
  assert.equal(await nodeFileSource(base).readText!("proj", "docs/a.md"), "one\ntwo\nthree\nfour\n");
});

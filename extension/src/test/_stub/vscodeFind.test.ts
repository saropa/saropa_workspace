// Tests for the stub's glob matching and findFiles, which the auto-shortcut tests use
// to stand in for the editor's file search.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findFiles, globToRegExp } from "./vscodeFind";
import { RelativePattern, Uri } from "./vscodeTypes";

test("a single star stays inside one path segment", () => {
  const re = globToRegExp("*.md");
  assert.equal(re.test("a.md"), true);
  assert.equal(re.test("dir/a.md"), false);
});

test("double star followed by a slash matches any depth, including none", () => {
  const re = globToRegExp("**/*.md");
  assert.equal(re.test("a.md"), true);
  assert.equal(re.test("x/y/a.md"), true);
  assert.equal(re.test("x/a.txt"), false);
});

test("a bare double star matches everything and a question mark one character", () => {
  assert.equal(globToRegExp("docs/**").test("docs/a/b.txt"), true);
  assert.equal(globToRegExp("a?.ts").test("ab.ts"), true);
  assert.equal(globToRegExp("a?.ts").test("abc.ts"), false);
});

test("regex metacharacters in a pattern are matched literally", () => {
  const re = globToRegExp("file(1)+.txt");
  assert.equal(re.test("file(1)+.txt"), true);
  assert.equal(re.test("file1.txt"), false);
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stubfind-")).replace(/\\/g, "/");
  for (const f of ["a.md", "docs/b.md", "docs/c.txt", "node_modules/d.md"]) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), "");
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const base = (): RelativePattern => new RelativePattern({ uri: Uri.file(dir), name: "p", index: 0 }, "**/*.md");
const names = (uris: Uri[]): string[] => uris.map((u) => path.relative(dir, u.fsPath).replace(/\\/g, "/")).sort();

test("findFiles returns folder-relative matches", async () => {
  assert.deepEqual(names(await findFiles(base())), ["a.md", "docs/b.md", "node_modules/d.md"]);
});

test("findFiles skips the excluded folder", async () => {
  assert.deepEqual(names(await findFiles(base(), "**/node_modules/**")), ["a.md", "docs/b.md"]);
});

test("findFiles stops at the result cap", async () => {
  assert.equal((await findFiles(base(), undefined, 1)).length, 1);
});

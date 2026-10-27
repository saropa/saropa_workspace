// Unit tests for PATH-based interpreter detection. PATH is pointed at a temp
// directory holding fake executables, so resolution, ordering, de-duplication and
// caching run for real. Windows-only install scanning is not exercised here.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectInterpreters, clearInterpreterCache, findOnPath } from "../exec/interpreterDetect";

const origPath = process.env.PATH;
const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
let bin: string;

beforeEach(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), "interp-"));
  process.env.PATH = bin;
  clearInterpreterCache();
});

afterEach(() => {
  process.env.PATH = origPath;
  Object.defineProperty(process, "platform", origPlatform);
  clearInterpreterCache();
});

function fake(name: string, dir = bin): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "#!/bin/sh\n");
  fs.chmodSync(p, 0o755);
  return p;
}

test("findOnPath resolves a binary from PATH", () => {
  const exe = fake("mytool");
  assert.equal(findOnPath("mytool"), exe);
});

test("findOnPath returns undefined for a missing or empty name", () => {
  assert.equal(findOnPath("nothing-here"), undefined);
  assert.equal(findOnPath(""), undefined);
});

test("findOnPath searches directories in order and skips directories named like the binary", () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "interp-a-"));
  fs.mkdirSync(path.join(first, "tool"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "interp-b-"));
  const exe = fake("tool", second);
  process.env.PATH = [first, second].join(path.delimiter);
  assert.equal(findOnPath("tool"), exe);
});

test("findOnPath ignores empty PATH segments and an unset PATH", () => {
  fake("mytool");
  process.env.PATH = [path.delimiter, bin, path.delimiter].join("");
  assert.ok(findOnPath("mytool"));
  delete process.env.PATH;
  assert.equal(findOnPath("mytool"), undefined);
});

test("findOnPath tries PATHEXT suffixes on Windows", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  process.env.PATHEXT = ".EXE;.CMD";
  const exe = fake("tool.CMD");
  assert.equal(findOnPath("tool"), exe);
  delete process.env.PATHEXT;
});

test("detectInterpreters lists only the catalog interpreters that exist", async () => {
  const py3 = fake("python3");
  const list = await detectInterpreters(".py");
  assert.deepEqual(list, [{ label: "python3", command: "python3", path: py3 }]);
});

test("detectInterpreters keeps catalog order and the extension is case-insensitive", async () => {
  fake("python3");
  fake("python");
  const list = await detectInterpreters(".PY");
  assert.deepEqual(list.map((i) => i.command), ["python", "python3"]);
});

test("a type with no catalog entry or no installed interpreter yields an empty list", async () => {
  assert.deepEqual(await detectInterpreters(".unknownext"), []);
  assert.deepEqual(await detectInterpreters(".py"), []);
});

test("results are cached per extension until the cache is cleared", async () => {
  assert.deepEqual(await detectInterpreters(".py"), []);
  fake("python3");
  assert.deepEqual(await detectInterpreters(".py"), []);
  clearInterpreterCache();
  assert.equal((await detectInterpreters(".py")).length, 1);
});

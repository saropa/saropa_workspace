// Unit tests for run-target inference (roadmap 7.5). detectRunTargets reads a
// target file through the stub's workspace.fs (real node fs against a temp dir) and
// derives a ShortcutExecConfig per discoverable way to run it — package.json scripts,
// Makefile targets, or a shebang. The REAL parsing runs (the package-manager pick
// from the sibling lockfile, the Makefile rule regex, the shebang detection); only
// the vscode host shell is faked, so these assertions check the derived exec shape.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri } from "./_stub/vscode";
import { detectRunTargets } from "../exec/runTargets";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-runtargets-"))
    .replace(/\\/g, "/");
});

afterEach(() => {
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// Write a file into the temp tree and return its stub Uri (file scheme, fsPath
// echoed) so detectRunTargets resolves the same on-disk file.
function writeFile(rel: string, body: string): Uri {
  const full = nodePath.join(tmpDir, rel).replace(/\\/g, "/");
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, body);
  return Uri.file(full);
}

test("package.json: one target per script, run via the detected package manager", async () => {
  // A pnpm-lock.yaml beside package.json makes the package manager resolve to pnpm.
  writeFile("pnpm-lock.yaml", "");
  const uri = writeFile(
    "package.json",
    JSON.stringify({ scripts: { build: "tsup", test: "jest" } })
  );

  const targets = await detectRunTargets(asUri(uri));
  assert.equal(targets.length, 2, "one target per script");

  const build = targets.find((t) => t.label.includes("build"));
  assert.ok(build, "a build target is offered");
  assert.equal(build!.exec.command, "pnpm");
  assert.deepEqual(build!.exec.args, ["run", "build"]);
  // The script body is the secondary line, and the file path is omitted (npm-script
  // runs name their work in args and run against cwd, not the package.json path).
  assert.equal(build!.exec.includeFilePath, false);
  assert.equal(build!.exec.cwd, "$dir");
  assert.equal(build!.detail, "tsup");
});

test("package.json: the package manager defaults to npm when no lockfile sits beside it", async () => {
  const uri = writeFile("package.json", JSON.stringify({ scripts: { dev: "vite" } }));
  const targets = await detectRunTargets(asUri(uri));
  assert.equal(targets.length, 1);
  assert.equal(targets[0].exec.command, "npm", "no lockfile -> npm default");
});

test("package.json: lockfile precedence picks yarn over npm when both are present", async () => {
  // The resolver checks pnpm, yarn, bun, then package-lock; with yarn.lock AND
  // package-lock.json present, yarn must win (it is checked first).
  writeFile("yarn.lock", "");
  writeFile("package-lock.json", "");
  const uri = writeFile("package.json", JSON.stringify({ scripts: { lint: "eslint ." } }));
  const targets = await detectRunTargets(asUri(uri));
  assert.equal(targets[0].exec.command, "yarn");
});

test("package.json: no scripts / not an object / invalid JSON all yield no targets", async () => {
  const noScripts = writeFile("a/package.json", JSON.stringify({ name: "pkg" }));
  assert.deepEqual(await detectRunTargets(asUri(noScripts)), []);

  const notObject = writeFile("b/package.json", JSON.stringify("just a string"));
  assert.deepEqual(await detectRunTargets(asUri(notObject)), []);

  const invalid = writeFile("c/package.json", "{ not valid json");
  assert.deepEqual(await detectRunTargets(asUri(invalid)), []);
});

test("Makefile: a target per rule, run via make, skipping pattern rules and duplicates", async () => {
  const body = [
    "build:",
    "\tgo build ./...",
    "test: build",
    "\tgo test ./...",
    "%.o: %.c", // pattern rule -> skipped
    "\tcc -c $<",
    "build:", // duplicate target name -> skipped the second time
    "\techo again",
    "VAR := value", // assignment with := must not match (the negative-lookahead guard)
  ].join("\n");
  const uri = writeFile("Makefile", body);

  const targets = await detectRunTargets(asUri(uri));
  const names = targets.map((t) => t.exec.args?.[0]);
  assert.deepEqual(names, ["build", "test"], "only the two distinct real targets");

  const build = targets[0];
  assert.equal(build.exec.command, "make");
  assert.deepEqual(build.exec.args, ["build"]);
  assert.equal(build.exec.includeFilePath, false);
  assert.equal(build.exec.cwd, "$dir");
});

test("Makefile: a .mk file is parsed the same as a Makefile", async () => {
  const uri = writeFile("rules.mk", "all:\n\techo hi\n");
  const targets = await detectRunTargets(asUri(uri));
  assert.deepEqual(
    targets.map((t) => t.exec.args?.[0]),
    ["all"]
  );
});

test("shebang: a script with a #! offers a target running through its interpreter", async () => {
  const uri = writeFile("deploy", "#!/usr/bin/env python3\nprint('hi')\n");
  const targets = await detectRunTargets(asUri(uri));
  assert.equal(targets.length, 1);
  // The interpreter the shebang names becomes the stored command (the env wrapper is
  // stripped), NOT a blank "run directly" prefix — a blank prefix opens the file on
  // Windows instead of running it. The file path is included so the script is the target.
  assert.equal(targets[0].exec.command, "python3");
  assert.equal(targets[0].exec.includeFilePath, true);
  // The shebang line is the detail, for disambiguation.
  assert.equal(targets[0].detail, "#!/usr/bin/env python3");
});

test("a plain file with no shebang and no recognized name yields no targets", async () => {
  const uri = writeFile("notes.txt", "just text, no shebang\nsecond line\n");
  assert.deepEqual(await detectRunTargets(asUri(uri)), []);
});

test("a file larger than the parse cap is not scanned (returns no targets)", async () => {
  // 257 KB exceeds the 256 KB cap, so the file is never read for targets even though
  // its first line is a valid shebang — guards against slurping a multi-megabyte file.
  const big = "#!/bin/sh\n" + "x".repeat(257 * 1024);
  const uri = writeFile("huge", big);
  assert.deepEqual(await detectRunTargets(asUri(uri)), []);
});

test("a missing file yields no targets rather than throwing", async () => {
  const uri = Uri.file(nodePath.join(tmpDir, "does-not-exist").replace(/\\/g, "/"));
  assert.deepEqual(await detectRunTargets(asUri(uri)), []);
});

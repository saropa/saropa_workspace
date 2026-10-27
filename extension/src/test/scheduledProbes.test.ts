// Tests for the scheduled-recipe file probes: reads, existence checks and the linter, test and
// outdated-package commands each ecosystem marker selects, including precedence between markers.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readText, exists, hasAny, detectLinter, detectTest, detectOutdated } from "../recipes/scheduledProbes";
import { createFsFixture, type FsFixture } from "./fsFixture";

let fx: FsFixture;

beforeEach(() => {
  fx = createFsFixture("sw-probes-");
});
afterEach(() => fx.remove());

test("readText returns the file text and undefined for a missing file", async () => {
  fx.write("a/b.txt", "héllo");
  assert.equal(await readText(fx.folder, "a", "b.txt"), "héllo");
  assert.equal(await readText(fx.folder, "missing.txt"), undefined);
});

test("exists is true for files and folders and false otherwise", async () => {
  fx.write("a/b.txt");
  assert.deepEqual([await exists(fx.folder, "a"), await exists(fx.folder, "a", "b.txt"), await exists(fx.folder, "c")], [true, true, false]);
});

test("hasAny is true when at least one name exists and false for none or an empty list", async () => {
  fx.write("two");
  assert.equal(await hasAny(fx.folder, ["one", "two"]), true);
  assert.equal(await hasAny(fx.folder, ["one", "three"]), false);
  assert.equal(await hasAny(fx.folder, []), false);
});

test("no marker means no linter, test or outdated command", async () => {
  assert.deepEqual([await detectLinter(fx.folder), await detectTest(fx.folder), await detectOutdated(fx.folder)], [undefined, undefined, undefined]);
});

test("a Dart project is linted with dart analyze, flutter analyze with a flutter section, plus custom_lint when used", async () => {
  fx.write("analysis_options.yaml", "include: package:lints/recommended.yaml\n");
  assert.equal(await detectLinter(fx.folder), "dart analyze");
  fx.write("pubspec.yaml", "name: x\nflutter:\n  uses-material-design: true\n");
  assert.equal(await detectLinter(fx.folder), "flutter analyze");
  fx.write("analysis_options.yaml", "analyzer:\n  plugins:\n    - saropa_lints\n");
  assert.equal(await detectLinter(fx.folder), "flutter analyze && dart run custom_lint");
  fx.write("pubspec.yaml", "name: x\n");
  assert.equal(await detectLinter(fx.folder), "dart analyze && dart run custom_lint");
});

test("analysis options win over an ESLint config beside them", async () => {
  fx.write("analysis_options.yaml");
  fx.write(".eslintrc.json");
  assert.equal(await detectLinter(fx.folder), "dart analyze");
});

test("each linter marker selects its own command", async () => {
  fx.write("eslint.config.mjs");
  assert.equal(await detectLinter(fx.folder), "npx eslint .");
  fx.remove();
  fx = createFsFixture("sw-probes-");
  fx.write("pyproject.toml", "[tool.ruff]\nline-length = 100\n");
  assert.equal(await detectLinter(fx.folder), "ruff check .");
  fx.write("pyproject.toml", "[project]\nname = 'x'\n");
  assert.equal(await detectLinter(fx.folder), undefined);
  fx.write("ruff.toml");
  assert.equal(await detectLinter(fx.folder), "ruff check .");
  fx.remove();
  fx = createFsFixture("sw-probes-");
  fx.write(".golangci.yaml");
  assert.equal(await detectLinter(fx.folder), "golangci-lint run");
  fx.remove();
  fx = createFsFixture("sw-probes-");
  fx.write("Cargo.toml");
  assert.equal(await detectLinter(fx.folder), "cargo clippy");
});

test("package.json counts as a test project only with a test script", async () => {
  fx.write("package.json", '{ "scripts": { "build": "tsc" } }');
  assert.equal(await detectTest(fx.folder), undefined);
  fx.write("package.json", '{ "scripts": { "test": "node --test" } }');
  assert.equal(await detectTest(fx.folder), "npm test");
});

test("test commands by marker, with a package test script taking precedence", async () => {
  fx.write("go.mod");
  assert.equal(await detectTest(fx.folder), "go test ./...");
  fx.write("Cargo.toml");
  assert.equal(await detectTest(fx.folder), "cargo test");
  fx.write("pubspec.yaml");
  assert.equal(await detectTest(fx.folder), "dart test");
  fx.write("package.json", '{ "scripts": { "test": "x" } }');
  assert.equal(await detectTest(fx.folder), "npm test");
});

test("pytest is selected by pyproject.toml or pytest.ini", async () => {
  fx.write("pytest.ini");
  assert.equal(await detectTest(fx.folder), "pytest");
  fx.remove();
  fx = createFsFixture("sw-probes-");
  fx.write("pyproject.toml");
  assert.equal(await detectTest(fx.folder), "pytest");
});

test("outdated commands by marker, package.json first", async () => {
  fx.write("go.mod");
  assert.equal(await detectOutdated(fx.folder), "go list -u -m all");
  fx.write("Cargo.toml");
  assert.equal(await detectOutdated(fx.folder), "cargo outdated");
  fx.write("requirements.txt");
  assert.equal(await detectOutdated(fx.folder), "pip list --outdated");
  fx.write("pubspec.yaml");
  assert.equal(await detectOutdated(fx.folder), "dart pub outdated");
  fx.write("package.json", "{}");
  assert.equal(await detectOutdated(fx.folder), "npm outdated; npm audit");
});

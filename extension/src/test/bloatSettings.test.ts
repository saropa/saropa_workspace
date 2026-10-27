// Tests for reading the workspace settings file (with JSONC tolerance), the watcher
// exclude list, and the test-downloader dependency check.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isWatcherExcluded, readSettings, usesTestDownloader, watcherExcludeGlobs } from "../exec/bloatSettings";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bloatset-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const writeSettings = (text: string): void => {
  fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".vscode", "settings.json"), text);
};

test("plain JSON settings are read as an object", async () => {
  writeSettings('{"a": 1}');
  assert.deepEqual(await readSettings(dir), { a: 1 });
});

test("comments and trailing commas are tolerated", async () => {
  writeSettings(`{
    // line comment
    "a": 1, /* block */
    "url": "http://example.com",
    "list": [1, 2,],
  }`);
  assert.deepEqual(await readSettings(dir), { a: 1, url: "http://example.com", list: [1, 2] });
});

test("a missing, unparseable or non-object settings file reads as undefined", async () => {
  assert.equal(await readSettings(dir), undefined);
  writeSettings("{ nope");
  assert.equal(await readSettings(dir), undefined);
  writeSettings("42");
  assert.equal(await readSettings(dir), undefined);
});

test("watcher excludes keep enabled globs, lowercased, and skip the ones switched off", () => {
  assert.deepEqual(
    watcherExcludeGlobs({ "files.watcherExclude": { "**/Node_Modules/**": true, "**/.git/**": false, "**/dist/**": true } }),
    ["**/node_modules/**", "**/dist/**"]
  );
});

test("no watcher exclude setting gives an empty list", () => {
  assert.deepEqual(watcherExcludeGlobs(undefined), []);
  assert.deepEqual(watcherExcludeGlobs({}), []);
  assert.deepEqual(watcherExcludeGlobs({ "files.watcherExclude": "x" }), []);
});

test("a folder counts as excluded when a glob mentions its name, ignoring case", () => {
  const globs = ["**/node_modules/**", "**/dist/**"];
  assert.equal(isWatcherExcluded("node_modules", globs), true);
  assert.equal(isWatcherExcluded("DIST", globs), true);
  assert.equal(isWatcherExcluded("build", globs), false);
  assert.equal(isWatcherExcluded("dist", []), false);
});

test("the test-downloader check looks in both dependency lists for either package", async () => {
  const write = (pkg: unknown): void => fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  write({ devDependencies: { "@vscode/test-electron": "^2" } });
  assert.equal(await usesTestDownloader(dir), true);
  write({ dependencies: { "@vscode/test-cli": "^0.1" } });
  assert.equal(await usesTestDownloader(dir), true);
  write({ devDependencies: { mocha: "^10" } });
  assert.equal(await usesTestDownloader(dir), false);
});

test("a missing or broken package.json is not a test-downloader project", async () => {
  assert.equal(await usesTestDownloader(dir), false);
  fs.writeFileSync(path.join(dir, "package.json"), "{ broken");
  assert.equal(await usesTestDownloader(dir), false);
});

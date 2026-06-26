// Unit tests for the pure run-command token logic (buildTokenMap / expandTokens).
// These carry NO VS Code dependency, so they run under Node's built-in test runner
// without the extension host. Paths are written POSIX-style; the functions use
// node's `path`, so the assertions here use forward slashes that path treats as
// separators on every platform the test runs on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTokenMap, expandTokens, SUPPORTED_TOKENS } from "../exec/tokens";

test("buildTokenMap derives every token from the file path", () => {
  const map = buildTokenMap("/home/me/proj/src/app.ts", "/home/me/proj");
  assert.equal(map.file, "/home/me/proj/src/app.ts");
  assert.equal(map.dir, "/home/me/proj/src");
  assert.equal(map.fileName, "app.ts");
  assert.equal(map.fileNameWithoutExt, "app");
  assert.equal(map.workspaceRoot, "/home/me/proj");
});

test("buildTokenMap falls back to the file's own dir when no workspace root", () => {
  // Outside any workspace folder $workspaceRoot must still yield a usable path,
  // not an empty string, so a command using it does not run against "".
  const map = buildTokenMap("/tmp/scratch/run.sh", undefined);
  assert.equal(map.workspaceRoot, "/tmp/scratch");
});

test("buildTokenMap handles a file with no extension", () => {
  const map = buildTokenMap("/usr/local/bin/deploy", "/usr/local");
  assert.equal(map.fileName, "deploy");
  assert.equal(map.fileNameWithoutExt, "deploy");
});

test("expandTokens substitutes known tokens", () => {
  const tokens = buildTokenMap("/p/src/a.ts", "/p");
  const unknown = new Set<string>();
  assert.equal(
    expandTokens("$workspaceRoot/out/$fileNameWithoutExt.js", tokens, unknown),
    "/p/out/a.js"
  );
  assert.equal(unknown.size, 0);
});

test("expandTokens matches the longest token name, not a prefix", () => {
  // $fileNameWithoutExt must resolve whole — not as $fileName followed by the
  // literal "WithoutExt", which would corrupt the value.
  const tokens = buildTokenMap("/p/src/report.md", "/p");
  const unknown = new Set<string>();
  assert.equal(expandTokens("$fileNameWithoutExt", tokens, unknown), "report");
});

test("expandTokens leaves an unknown $name literal and records it", () => {
  // A literal $name may be an intentional shell variable (e.g. $HOME) the shell
  // should expand, so blanking it would be wrong — it is kept and reported once.
  const tokens = buildTokenMap("/p/src/a.ts", "/p");
  const unknown = new Set<string>();
  const out = expandTokens("$HOME/bin $file", tokens, unknown);
  assert.equal(out, "$HOME/bin /p/src/a.ts");
  assert.deepEqual([...unknown], ["HOME"]);
});

test("expandTokens reports each distinct unknown token once", () => {
  const unknown = new Set<string>();
  expandTokens("$a $b $a", {}, unknown);
  assert.deepEqual([...unknown].sort(), ["a", "b"]);
});

test("SUPPORTED_TOKENS lists exactly the keys buildTokenMap produces", () => {
  // The help text and the resolver share this list; if buildTokenMap gains or
  // drops a token, this guard fails so the documented set cannot silently drift.
  const produced = Object.keys(buildTokenMap("/p/a.ts", "/p")).sort();
  assert.deepEqual([...SUPPORTED_TOKENS].sort(), produced);
});

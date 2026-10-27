// The board core must stay free of VS Code. The test build replaces the "vscode"
// import with a stub, so a stray import would pass silently; this test fails instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("no file in src/board imports vscode", () => {
  const dir = path.join(__dirname, "..", "..", "..", "src", "board");
  const offenders = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /from\s+["']vscode["']|require\(["']vscode["']\)/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(offenders, []);
});

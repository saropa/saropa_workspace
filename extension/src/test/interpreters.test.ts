// Unit tests for the pure interpreter catalog (interpreters.ts). No IO: these assert
// the per-extension candidate lists, their ordering, and the probe-binary extraction
// the detection layer relies on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesForExt, commandBinary } from "../exec/interpreters";

test("commandBinary: takes the first token of a multi-token prefix", () => {
  assert.equal(commandBinary("pwsh -File"), "pwsh");
  assert.equal(commandBinary("py -3"), "py");
  assert.equal(commandBinary("python"), "python");
  assert.equal(commandBinary("  deno run  "), "deno");
});

test("candidatesForExt: .py leads with the py launcher, then python, python3", () => {
  const cands = candidatesForExt(".py");
  assert.deepEqual(
    cands.map((c) => c.command),
    ["py", "python", "python3"]
  );
});

test("candidatesForExt: a multi-token prefix probes only its binary", () => {
  // ".ps1" -> "pwsh -File" must look for "pwsh" on PATH, not "pwsh -File".
  const ps = candidatesForExt(".ps1");
  assert.equal(ps[0].command, "pwsh -File");
  assert.equal(ps[0].probeBinary, "pwsh");
});

test("candidatesForExt: node is shared across the JavaScript module extensions", () => {
  for (const ext of [".js", ".mjs", ".cjs"]) {
    assert.deepEqual(
      candidatesForExt(ext).map((c) => c.command),
      ["node"],
      `${ext} resolves through node`
    );
  }
});

test("candidatesForExt: an unknown / plain-document extension yields no candidates", () => {
  assert.deepEqual(candidatesForExt(".txt"), []);
  assert.deepEqual(candidatesForExt(".md"), []);
  assert.deepEqual(candidatesForExt(""), []);
});

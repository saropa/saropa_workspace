// Hiding one document from the board through the rules file's `hiddenDocs` table: the text edit
// (hideDoc) and the lookup (isHidden). Pure text in, text out; no host needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hideDoc, isHidden } from "../../board/ruleHide";

const target = { project: "app", path: "docs/old.md" };

test("hideDoc creates the file content when the rules file is blank", () => {
  const r = hideDoc(undefined, target);
  assert.equal(r.ok, true);
  if (r.ok) {
    const doc = JSON.parse(r.text) as { version: number; hiddenDocs: Record<string, string[]> };
    assert.deepEqual(doc.hiddenDocs, { app: ["docs/old.md"] });
    // A blank file starts as a version 1 rules file, so the result is a valid rules file.
    assert.equal(doc.version, 1);
  }
});

test("hideDoc appends to an existing list and keeps other projects and keys", () => {
  const text = JSON.stringify({ version: 1, ignore: ["x"], hiddenDocs: { app: ["a.md"], other: ["b.md"] } }, null, 2) + "\n";
  const r = hideDoc(text, target);
  assert.equal(r.ok, true);
  if (r.ok) {
    const doc = JSON.parse(r.text) as { ignore: string[]; hiddenDocs: Record<string, string[]> };
    assert.deepEqual(doc.hiddenDocs.app, ["a.md", "docs/old.md"]);
    assert.deepEqual(doc.hiddenDocs.other, ["b.md"]);
    assert.deepEqual(doc.ignore, ["x"]);
    // The source indent and trailing newline survive the rewrite.
    assert.ok(r.text.startsWith('{\n  "version"'));
    assert.ok(r.text.endsWith("\n"));
  }
});

test("hideDoc refuses a path that is already hidden with reason same", () => {
  const text = JSON.stringify({ version: 1, hiddenDocs: { app: ["docs/old.md"] } });
  assert.deepEqual(hideDoc(text, target), { ok: false, reason: "same" });
});

test("hideDoc treats the same path in another project as not yet hidden", () => {
  const text = JSON.stringify({ version: 1, hiddenDocs: { other: ["docs/old.md"] } });
  const r = hideDoc(text, target);
  assert.equal(r.ok, true);
});

test("hideDoc refuses unparseable text instead of overwriting it", () => {
  assert.deepEqual(hideDoc("{ not json", target), { ok: false, reason: "parse" });
});

test("hideDoc refuses a hiddenDocs of the wrong shape, as the owner's data", () => {
  assert.deepEqual(hideDoc(JSON.stringify({ version: 1, hiddenDocs: [] }), target), { ok: false, reason: "shape" });
  assert.deepEqual(hideDoc(JSON.stringify({ version: 1, hiddenDocs: { app: "docs/old.md" } }), target), { ok: false, reason: "shape" });
});

test("hideDoc refuses a rules file that is not a plain object", () => {
  assert.deepEqual(hideDoc("[1]", target), { ok: false, reason: "shape" });
});

test("isHidden finds an exact project and path match", () => {
  const table = { app: ["docs/old.md"] };
  assert.equal(isHidden(table, "app", "docs/old.md"), true);
  assert.equal(isHidden(table, "app", "docs/new.md"), false);
  assert.equal(isHidden(table, "other", "docs/old.md"), false);
});

test("isHidden hides nothing for a table that is not a map of lists", () => {
  for (const bad of [undefined, null, "x", 3, [], { app: "docs/old.md" }, { app: { 0: "docs/old.md" } }]) {
    assert.equal(isHidden(bad, "app", "docs/old.md"), false);
  }
});

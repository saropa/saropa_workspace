// Moving one document into a group, or out of every group, in the text of the rules file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanGroupName, manualGroupNames, setDocGroup } from "../../board/groupEdit";

const a = { project: "app", path: "docs/a.md" };

function text(r: ReturnType<typeof setDocGroup>): string {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.text;
}

test("a new group is made with the exact project and path", () => {
  const out = JSON.parse(text(setDocGroup(undefined, { ...a, group: "Launch" })));
  assert.deepEqual(out, { version: 1, groups: [{ name: "Launch", match: ["app/docs/a.md"] }] });
});

test("an existing group takes the document, and a move leaves the old group", () => {
  const before = JSON.stringify({ groups: [{ name: "One", match: ["app/docs/a.md", "app/b.md"] }, { name: "Two", match: [] }] });
  const out = JSON.parse(text(setDocGroup(before, { ...a, group: "Two" })));
  assert.deepEqual(out.groups, [{ name: "One", match: ["app/b.md"] }, { name: "Two", match: ["app/docs/a.md"] }]);
});

test("moving into a group lifts an exclusion, and the group name is tidied", () => {
  const before = JSON.stringify({ ungrouped: ["app/docs/a.md", "app/other.md"] });
  const out = JSON.parse(text(setDocGroup(before, { ...a, group: "  Launch   plan " })));
  assert.deepEqual(out.ungrouped, ["app/other.md"]);
  assert.equal(out.groups[0].name, "Launch plan");
  assert.equal(JSON.parse(text(setDocGroup(JSON.stringify({ ungrouped: ["app/docs/a.md"] }), { ...a, group: "X" }))).ungrouped, undefined);
});

test("removing takes the document out of every group and keeps it out of automatic ones", () => {
  const before = JSON.stringify({ groups: [{ name: "One", match: ["app/docs/a.md"] }] });
  const out = JSON.parse(text(setDocGroup(before, { ...a, group: undefined })));
  assert.deepEqual(out.groups, [{ name: "One", match: [] }]);
  assert.deepEqual(out.ungrouped, ["app/docs/a.md"]);
});

test("removing a document that is already out writes nothing", () => {
  const r = setDocGroup(JSON.stringify({ ungrouped: ["app/docs/a.md"] }), { ...a, group: undefined });
  assert.deepEqual(r, { ok: false, reason: "none" });
});

test("a wildcard in the path, a bad name, a file that does not parse and a wrong shape are refused", () => {
  assert.deepEqual(setDocGroup(undefined, { project: "app", path: "docs/a*.md", group: "X" }), { ok: false, reason: "glob" });
  assert.deepEqual(setDocGroup(undefined, { ...a, group: "   " }), { ok: false, reason: "name" });
  assert.deepEqual(setDocGroup(undefined, { ...a, group: "x".repeat(61) }), { ok: false, reason: "name" });
  assert.deepEqual(setDocGroup("{nope", { ...a, group: "X" }), { ok: false, reason: "parse" });
  assert.deepEqual(setDocGroup('{"groups":{}}', { ...a, group: "X" }), { ok: false, reason: "shape" });
  assert.deepEqual(setDocGroup('{"groups":[{"name":"X","match":"a"}]}', { ...a, group: "X" }), { ok: false, reason: "shape" });
  assert.deepEqual(setDocGroup('{"ungrouped":"a"}', { ...a, group: undefined }), { ok: false, reason: "shape" });
  assert.deepEqual(setDocGroup('{"a":1,"a":2}', { ...a, group: "X" }), { ok: false, reason: "lossy" });
});

test("the indent, the line ends and the trailing newline of the file are kept", () => {
  const crlf = '{\r\n\t"version": 1\r\n}\r\n';
  const out = text(setDocGroup(crlf, { ...a, group: "X" }));
  assert.ok(out.includes("\r\n\t") && out.endsWith("}\r\n") && !/[^\r]\n/.test(out));
  const bare = '{"version":1}';
  assert.equal(text(setDocGroup(bare, { ...a, group: "X" })).endsWith("\n"), false);
});

test("group names are cleaned and listed once each", () => {
  assert.equal(cleanGroupName("a\tb"), "a b");
  assert.equal(cleanGroupName("a\u0001b"), undefined);
  assert.deepEqual(manualGroupNames({ groups: [{ name: "B" }, { name: "A" }, { name: "B" }, 3, { name: 4 }] }), ["B", "A"]);
  assert.deepEqual(manualGroupNames({ groups: "x" }), []);
});

test("a move is refused when a pattern of an earlier group or of ungrouped still claims the document", () => {
  const early = JSON.stringify({ groups: [{ name: "Docs", match: ["app/docs/*"] }, { name: "Two", match: [] }] });
  assert.deepEqual(setDocGroup(early, { ...a, group: "Two" }), { ok: false, reason: "claimed" });
  const wild = JSON.stringify({ ungrouped: ["app/docs/*"] });
  assert.deepEqual(setDocGroup(wild, { ...a, group: "Two" }), { ok: false, reason: "claimed" });
});

test("a move into a group a wildcard already puts the document in, or the exact group, is reported as the same", () => {
  const wild = JSON.stringify({ groups: [{ name: "Docs", match: ["app/docs/*"] }] });
  assert.deepEqual(setDocGroup(wild, { ...a, group: "Docs" }), { ok: false, reason: "same" });
  const exact = JSON.stringify({ groups: [{ name: "One", match: ["app/docs/a.md"] }] });
  assert.deepEqual(setDocGroup(exact, { ...a, group: "One" }), { ok: false, reason: "same" });
});

test("names are compared tidied: no duplicate group is added, and a duplicate name takes it in the first", () => {
  const spaced = JSON.stringify({ groups: [{ name: "Launch  plan ", match: [] }, { name: "Launch plan", match: [] }] });
  const out = JSON.parse(text(setDocGroup(spaced, { ...a, group: "Launch plan" })));
  assert.equal(out.groups.length, 2);
  assert.deepEqual(out.groups[0].match, ["app/docs/a.md"]);
  assert.deepEqual(manualGroupNames({ groups: [{ name: "A  b" }, { name: "A b" }, { name: "x".repeat(61) }] }), ["A b"]);
});

test("the last document leaving a group keeps the entry", () => {
  const out = JSON.parse(text(setDocGroup(JSON.stringify({ groups: [{ name: "One", match: ["app/docs/a.md"] }] }), { ...a, group: undefined })));
  assert.deepEqual(out.groups, [{ name: "One", match: [] }]);
});

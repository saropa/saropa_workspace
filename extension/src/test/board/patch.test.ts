// The reply patch: reading the text, checking each change against the board, and the text edits
// an accepted change makes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHANGES, MAX_PATCH_CHARS, PatchCheck, PatchTarget, checkPatch, extractPatch } from "../../board/patch";
import { addNeedsLine, removeNeedsLine, setDocGroup } from "../../board/patchApply";

const target = (id: string, over: Partial<PatchTarget> = {}): PatchTarget => {
  const [project, path] = id.split(":");
  return { id, title: path, project, path, rev: "100-10", status: "amber", severity: "medium", needs: [], ...over };
};
const targets = new Map([target("app:a.md"), target("app:b.md", { needs: ["app:a.md"], group: "Launch" }), target("lib:c.md")].map((t) => [t.id, t]));
const STATUSES = ["red", "amber", "green"];
// Every change names the board's revision unless it says otherwise.
const withRev = (c: unknown): unknown => (typeof c === "object" && c !== null && !("rev" in c) ? { rev: "100-10", ...c } : c);
const patch = (changes: unknown[], over: Record<string, unknown> = {}): string => JSON.stringify({ schema: "saropa.releaseBoard.patch/1", basedOn: "x", changes: changes.map(withRev), ...over });
const ok = (c: PatchCheck): Extract<PatchCheck, { ok: true }> => {
  assert.equal(c.ok, true);
  return c as Extract<PatchCheck, { ok: true }>;
};
const refusals = (changes: unknown[]): string[] => ok(checkPatch(patch(changes), targets, STATUSES)).refused.map((r) => r.reason);

test("a valid patch lists one row per change with before and after", () => {
  const c = ok(
    checkPatch(
      patch([
        { op: "setStatus", item: "app:a.md", to: "green", reason: "Done in PR 5", rev: "100-10" },
        { op: "setSeverity", item: "app:a.md", to: "low", reason: "Cosmetic" },
        { op: "addNeeds", item: "app:a.md", on: "lib:c.md", reason: "Needs the keys" },
        { op: "removeNeeds", item: "app:b.md", on: "app:a.md", reason: "Finished" },
        { op: "setGroup", item: "app:a.md", group: "Store launch", reason: "Belongs" },
      ]),
      targets,
      STATUSES
    )
  );
  assert.equal(c.basedOn, "x");
  assert.deepEqual(c.refused, []);
  assert.deepEqual(c.rows.map((r) => [r.change.op, r.before, r.after, r.stale]), [
    ["setStatus", "amber", "green", false],
    ["setSeverity", "medium", "low", false],
    ["addNeeds", "", "c.md", false],
    ["removeNeeds", "a.md", "", false],
    ["setGroup", "", "Store launch", false],
  ]);
});

test("a reply is read from the tagged block, or bare JSON, and nothing else", () => {
  const body = patch([]);
  assert.equal(extractPatch(`Here you go\n\`\`\`json saropa-patch\n${body}\n\`\`\`\nbye`), body);
  assert.equal(extractPatch(`  ${body}  `), body);
  assert.equal(extractPatch("sure, done"), undefined);
  assert.equal(extractPatch("```json\n{}\n```"), undefined);
});

test("a whole text is refused: empty, oversize, not JSON, wrong shape, other or newer schema, too many", () => {
  const reason = (raw: string): unknown => {
    const c = checkPatch(raw, targets, STATUSES);
    return c.ok ? "ok" : c.reason;
  };
  assert.equal(reason("  "), "empty");
  assert.equal(reason(" ".repeat(MAX_PATCH_CHARS) + "{}"), "tooLarge");
  assert.equal(reason("{nope"), "notJson");
  assert.equal(reason("[]"), "shape");
  assert.equal(reason(patch([], { extra: 1 })), "shape");
  assert.equal(reason(JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes: "x" })), "shape");
  assert.equal(reason(patch([], { schema: "other/1" })), "schema");
  assert.equal(reason(patch([], { schema: "saropa.releaseBoard.patch/2" })), "newer");
  assert.equal(reason(patch(new Array(MAX_CHANGES + 1).fill({}))), "tooMany");
});

test("each bad change is refused alone with its reason, and the good ones stay", () => {
  const bad = [
    "not an object",
    { op: "setStatus", item: "app:a.md", to: "green", reason: "x", extra: true },
    { op: "setStatus", item: "app:a.md", to: "green", reason: "x", rev: "late" },
    { op: "setImportance", item: "app:a.md", to: "high", reason: "x" },
    { op: "setStatus", item: "app:gone.md", to: "green", reason: "x" },
    { op: "setStatus", item: "../../etc/passwd", to: "green", reason: "x" },
    { op: "setStatus", item: "app:a.md", to: "purple", reason: "x" },
    { op: "setStatus", item: "app:a.md", to: "amber", reason: "x" },
    { op: "setSeverity", item: "app:a.md", to: "huge", reason: "x" },
    { op: "setGroup", item: "app:a.md", group: "", reason: "x" },
    { op: "setGroup", item: "app:a.md", group: "a\nb", reason: "x" },
    { op: "setGroup", item: "app:b.md", group: "Launch", reason: "x" },
    { op: "addNeeds", item: "app:a.md", on: "app:gone.md", reason: "x" },
    { op: "addNeeds", item: "app:a.md", on: "app:a.md", reason: "x" },
    { op: "addNeeds", item: "app:a.md", on: "app:b.md", reason: "x" },
    { op: "addNeeds", item: "app:b.md", on: "app:a.md", reason: "x" },
    { op: "removeNeeds", item: "app:a.md", on: "app:b.md", reason: "x" },
    { op: "setStatus", item: "app:a.md", to: "green", reason: "y".repeat(400) },
    { op: "setSeverity", item: "app:a.md", to: "low", reason: "x" },
  ];
  assert.deepEqual(refusals(bad), ["shape", "shape", "shape", "unknownOp", "unknownItem", "unknownItem", "badValue", "same", "badValue", "badValue", "badValue", "same", "unknownTarget", "circle", "circle", "linked", "notLinked", "tooLong"]);
  const c = ok(checkPatch(patch(bad), targets, STATUSES));
  assert.deepEqual(c.rows.map((r) => r.change.op), ["setSeverity"]);
  assert.equal(c.refused[0].n, 1);
});

test("two links that would close a circle together are caught on the second", () => {
  const r = refusals([
    { op: "addNeeds", item: "app:a.md", on: "lib:c.md", reason: "x" },
    { op: "addNeeds", item: "lib:c.md", on: "app:a.md", reason: "x" },
  ]);
  assert.deepEqual(r, ["circle"]);
});

test("a path that cannot be written into a Needs line is refused", () => {
  const odd = new Map([...targets, ["app:a, b.md", target("app:a, b.md")]]);
  const c = ok(checkPatch(patch([{ op: "addNeeds", item: "app:a.md", on: "app:a, b.md", reason: "x" }]), odd, STATUSES));
  assert.deepEqual(c.refused.map((r) => r.reason), ["badValue"]);
});

test("a revision that differs from the board's marks the row stale", () => {
  const c = ok(checkPatch(patch([{ op: "setSeverity", item: "app:a.md", to: "low", reason: "x", rev: "99-9" }]), targets, STATUSES));
  assert.equal(c.rows[0].stale, true);
});

test("a group is written into the rules file once, moved out of other groups", () => {
  const first = setDocGroup(undefined, { project: "app", path: "a.md", group: "Launch" });
  assert.equal(first.ok, true);
  const moved = setDocGroup((first as { text: string }).text, { project: "app", path: "a.md", group: "Store" });
  assert.deepEqual(JSON.parse((moved as { text: string }).text).groups, [{ name: "Store", match: ["app/a.md"] }]);
  assert.deepEqual(setDocGroup("{ nope", { project: "app", path: "a.md", group: "x" }), { ok: false, reason: "parse" });
  assert.deepEqual(setDocGroup('{"groups": 3}', { project: "app", path: "a.md", group: "x" }), { ok: false, reason: "shape" });
  assert.deepEqual(setDocGroup(undefined, { project: "app", path: "a*.md", group: "x" }), { ok: false, reason: "glob" });
});

test("a Needs line is added under the title, appended to an existing line, and never twice", () => {
  assert.deepEqual(addNeedsLine("# Title\n\nBody\n", "docs/x.md"), { ok: true, text: "# Title\n\nNeeds: docs/x.md\n\nBody\n" });
  assert.deepEqual(addNeedsLine("# Title\nBody\n", "x.md"), { ok: true, text: "# Title\n\nNeeds: x.md\n\nBody\n" });
  assert.deepEqual(addNeedsLine("Body\n", "x.md"), { ok: true, text: "Needs: x.md\n\nBody\n" });
  assert.deepEqual(addNeedsLine("---\nid: 1\n---\n# T\ntext", "x.md"), { ok: true, text: "---\nid: 1\n---\n# T\n\nNeeds: x.md\n\ntext" });
  assert.deepEqual(addNeedsLine("# T\n\nNeeds: a.md\nBody\n", "b.md"), { ok: true, text: "# T\n\nNeeds: a.md, b.md\nBody\n" });
  assert.deepEqual(addNeedsLine("# T\r\n\r\nBody\r\n", "x.md"), { ok: true, text: "# T\r\n\r\nNeeds: x.md\r\n\r\nBody\r\n" });
  assert.deepEqual(addNeedsLine("# T\n\nNeeds: [A](a.md)\n", "a.md"), { ok: false, reason: "none" });
});

test("a Needs target is taken out of its line; an emptied line goes; a missing one is refused", () => {
  assert.deepEqual(removeNeedsLine("# T\n\nNeeds: a.md, b.md\nBody\n", ["a.md"]), { ok: true, text: "# T\n\nNeeds: b.md\nBody\n" });
  assert.deepEqual(removeNeedsLine("# T\nNeeds: [A](a.md)\nBody\n", ["a.md"]), { ok: true, text: "# T\nBody\n" });
  assert.deepEqual(removeNeedsLine("# T\nNeeds: a.md\n", ["app:a.md", "other.md"]), { ok: false, reason: "none" });
  assert.deepEqual(removeNeedsLine("# T\nNeeds: app:a.md; b.md\n", ["app:a.md"]), { ok: true, text: "# T\nNeeds: b.md\n" });
});

test("extracting a patch from crafted text takes linear time, and an oversize reply is not scanned", () => {
  const crafted = "x```json saropa-patch\n".repeat(9_000);
  const t = Date.now();
  assert.equal(extractPatch(crafted), undefined);
  assert.equal(extractPatch("x```json saropa-patch\n".repeat(50_000)), undefined, "over the limit");
  assert.equal(extractPatch("```json saropa-patch\n".repeat(9_000) + "`".repeat(150_000)), undefined);
  assert.ok(Date.now() - t < 100, `took ${Date.now() - t} ms`);
  const body = patch([]);
  assert.equal(extractPatch(`a\r\n\`\`\`\`json  saropa-patch  \r\n${body}\r\n\`\`\`\`\r\nz`), body);
  assert.equal(extractPatch(`\`\`\`json saropa-patch\n${body}\n\`\`\``), body);
});

test("a change without a revision is refused, and an old result file replayed after the document moved is stale", () => {
  const none = JSON.stringify({ schema: "saropa.releaseBoard.patch/1", changes: [{ op: "setSeverity", item: "app:a.md", to: "low", reason: "x" }] });
  assert.deepEqual(ok(checkPatch(none, targets, STATUSES)).refused.map((r) => r.reason), ["noRevision"]);
  const moved = new Map([...targets, ["app:a.md", target("app:a.md", { rev: "200-11" })]]);
  const c = ok(checkPatch(patch([{ op: "setSeverity", item: "app:a.md", to: "low", reason: "x" }]), moved, STATUSES));
  assert.deepEqual(c.rows.map((r) => r.stale), [true]);
});

test("schema version 0 and a leading zero are refused; only version 1 is read", () => {
  const reason = (schema: string): unknown => {
    const c = checkPatch(JSON.stringify({ schema, changes: [] }), targets, STATUSES);
    return c.ok ? "ok" : c.reason;
  };
  assert.equal(reason("saropa.releaseBoard.patch/0"), "schema");
  assert.equal(reason("saropa.releaseBoard.patch/01"), "schema");
  assert.equal(reason("saropa.releaseBoard.patch/1"), "ok");
  assert.equal(reason("saropa.releaseBoard.patch/2"), "newer");
});

test("group names and reasons are normalized; hidden characters go; look-alike group names are refused", () => {
  const tag = String.fromCodePoint(0xe0041);
  const c = ok(checkPatch(patch([
    { op: "setGroup", item: "app:a.md", group: `Store​ launch${tag}­`, reason: "ｆｕｌｌ️width" },
    { op: "setGroup", item: "lib:c.md", group: "Hiddenㅤ", reason: "x" },
    { op: "setGroup", item: "lib:c.md", group: "Bad\u0007name", reason: "x" },
    { op: "setGroup", item: "lib:c.md", group: "launch", reason: "x" },
    { op: "setGroup", item: "lib:c.md", group: "LAUNCH​", reason: "x" },
    { op: "setGroup", item: "lib:c.md", group: "private", reason: "x" },
  ]), targets, STATUSES));
  assert.deepEqual(c.rows.map((r) => [r.change.group, r.change.reason]), [["Store launch", "fullwidth"], ["Hidden", "x"]]);
  assert.deepEqual(c.refused.map((r) => r.reason), ["badValue", "lookalike", "lookalike", "badValue"]);
});

test("one change per kind and item: a repeat is dropped and reported", () => {
  const c = ok(checkPatch(patch([
    { op: "setSeverity", item: "app:a.md", to: "low", reason: "x" },
    { op: "setSeverity", item: "app:a.md", to: "high", reason: "x" },
    { op: "setStatus", item: "app:a.md", to: "green", reason: "x" },
    { op: "addNeeds", item: "app:a.md", on: "lib:c.md", reason: "x" },
    { op: "addNeeds", item: "app:a.md", on: "lib:c.md", reason: "x" },
  ]), targets, STATUSES));
  assert.deepEqual(c.rows.map((r) => r.change.op), ["setSeverity", "setStatus", "addNeeds"]);
  assert.deepEqual(c.refused.map((r) => [r.n, r.reason]), [[2, "duplicate"], [5, "linked"]]);
});

test("a group edit keeps the owner's empty groups, drops only a group it emptied, and refuses what would not take effect", () => {
  const file = JSON.stringify({ version: 1, groups: [{ name: "Empty", match: [] }, { name: "Old", match: ["app/a.md"] }] });
  const moved = setDocGroup(file, { project: "app", path: "a.md", group: "New" });
  assert.deepEqual(JSON.parse((moved as { text: string }).text).groups, [{ name: "Empty", match: [] }, { name: "New", match: ["app/a.md"] }]);
  const shadow = JSON.stringify({ version: 1, groups: [{ name: "Broad", match: ["app/*.md"] }] });
  assert.deepEqual(setDocGroup(shadow, { project: "app", path: "a.md", group: "Mine" }), { ok: false, reason: "shadowed" });
  assert.equal(setDocGroup(shadow, { project: "app", path: "a.md", group: "Broad" }).ok, true);
  assert.deepEqual(setDocGroup(shadow, { project: "app", path: "a.md", group: "broad" }), { ok: false, reason: "lookalike" });
});

test("Needs removal splits on 'and' and Markdown links like the board reader, and keeps each line's own ending", () => {
  assert.deepEqual(removeNeedsLine("# T\nNeeds: a.md and b.md\n", ["a.md"]), { ok: true, text: "# T\nNeeds: b.md\n" });
  assert.deepEqual(removeNeedsLine("# T\nNeeds: [Plan, part 1](docs/x.md), b.md\n", ["docs/x.md"]), { ok: true, text: "# T\nNeeds: b.md\n" });
  assert.deepEqual(removeNeedsLine("# T\r\nNeeds: a.md, b.md\nmid\r\nNeeds: a.md\n\r\nend", ["a.md"]), { ok: true, text: "# T\r\nNeeds: b.md\nmid\r\n\r\nend" });
  assert.deepEqual(addNeedsLine("# T\r\n\nBody\nmore\r\n", "x.md"), { ok: true, text: "# T\r\n\r\nNeeds: x.md\r\n\nBody\nmore\r\n" });
  assert.deepEqual(addNeedsLine("# T", "x.md"), { ok: true, text: "# T\n\nNeeds: x.md" });
});

test("a Needs line inside a code fence is neither changed nor counted", () => {
  const doc = "# T\n\n```md\nNeeds: a.md\n```\n\n~~~\nNeeds: a.md\n~~~\n\nBody\n";
  assert.deepEqual(removeNeedsLine(doc, ["a.md"]), { ok: false, reason: "none" });
  const added = addNeedsLine(doc, "b.md") as { ok: true; text: string };
  assert.equal(added.text, "# T\n\nNeeds: b.md\n\n```md\nNeeds: a.md\n```\n\n~~~\nNeeds: a.md\n~~~\n\nBody\n");
  assert.deepEqual(addNeedsLine("# T\n\n```\nNeeds: a.md\n```\n", "a.md").ok, true, "the fenced line does not count as listing it");
});

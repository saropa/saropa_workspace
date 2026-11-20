// Turning accepted patch rows into new file text: the group entry of the rules file (setDocGroup), the row
// dispatcher (applyRuleRow) and the Needs-line edits, with the reasons each one refuses with.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PatchChange, PatchRow, PatchTarget } from "../../board/patch";
import { addNeedsLine, applyRuleRow, needsSpellings, needsWrite, removeNeedsLine, setDocGroup } from "../../board/patchApply";
import { RuleCategory } from "../../board/ruleAssign";

const GROUP = { project: "app", path: "docs/a.md", group: "Launch" };
const ENTRY = "app/docs/a.md";

// The text of a successful edit; fails the test when the edit was refused.
type Edit = ReturnType<typeof setDocGroup>;
const textOf = (e: Edit): string => {
  assert.equal(e.ok, true, "expected the edit to succeed");
  return (e as Extract<Edit, { ok: true }>).text;
};
const reasonOf = (e: Edit): string => {
  assert.equal(e.ok, false, "expected the edit to be refused");
  return (e as Extract<Edit, { ok: false }>).reason;
};
const groupsOf = (e: Edit): unknown => (JSON.parse(textOf(e)) as { groups?: unknown }).groups;

const file = (doc: unknown): string => JSON.stringify(doc, null, 2) + "\n";

test("setDocGroup: a blank file gets a new group holding the document's exact entry", () => {
  const e = setDocGroup(undefined, GROUP);
  assert.deepEqual(JSON.parse(textOf(e)), { version: 1, groups: [{ name: "Launch", match: [ENTRY] }] });
});

test("setDocGroup: a path with a wildcard character is refused as a glob problem", () => {
  assert.equal(reasonOf(setDocGroup(undefined, { ...GROUP, path: "docs/*.md" })), "glob");
  assert.equal(reasonOf(setDocGroup(undefined, { ...GROUP, path: "" })), "glob");
});

test("setDocGroup: text that does not parse, a non-object file and a repeated key are refused", () => {
  assert.equal(reasonOf(setDocGroup("{", GROUP)), "parse");
  assert.equal(reasonOf(setDocGroup("[]", GROUP)), "shape");
  // A repeated key would lose its first value on rewrite.
  assert.equal(reasonOf(setDocGroup('{"a":1,"a":2}', GROUP)), "lossy");
});

test("setDocGroup: a groups key that is not a list, or holds a malformed group, is refused", () => {
  assert.equal(reasonOf(setDocGroup(file({ groups: {} }), GROUP)), "shape");
  assert.equal(reasonOf(setDocGroup(file({ groups: ["x"] }), GROUP)), "shape");
  assert.equal(reasonOf(setDocGroup(file({ groups: [{ name: "A" }] }), GROUP)), "shape");
  assert.equal(reasonOf(setDocGroup(file({ groups: [{ name: 5, match: [] }] }), GROUP)), "shape");
});

test("setDocGroup: a group that differs from an existing one only by case or hidden characters is refused", () => {
  const text = file({ groups: [{ name: "launch", match: [] }] });
  assert.equal(reasonOf(setDocGroup(text, GROUP)), "lookalike");
  // A zero-width space is invisible, so "Launch" and "Launch" followed by one look identical on the board.
  assert.equal(reasonOf(setDocGroup(file({ groups: [{ name: "Launch", match: [] }] }), { ...GROUP, group: "Launch​" })), "lookalike");
});

test("setDocGroup: the same group name again reuses the group instead of refusing", () => {
  const text = file({ groups: [{ name: "Launch", match: ["app/other.md"] }] });
  assert.deepEqual(groupsOf(setDocGroup(text, GROUP)), [{ name: "Launch", match: ["app/other.md", ENTRY] }]);
});

test("setDocGroup: the document leaves its old group, and the other entries of that group stay", () => {
  const text = file({ groups: [{ name: "A", match: [ENTRY, "app/x.md"] }, { name: "B", match: [] }] });
  assert.deepEqual(groupsOf(setDocGroup(text, { ...GROUP, group: "B" })), [
    { name: "A", match: ["app/x.md"] },
    { name: "B", match: [ENTRY] },
  ]);
});

test("setDocGroup: a group this change empties stays, as when the board moves the document", () => {
  const text = file({ groups: [{ name: "A", match: [ENTRY] }] });
  assert.deepEqual(groupsOf(setDocGroup(text, { ...GROUP, group: "B" })), [{ name: "A", match: [] }, { name: "B", match: [ENTRY] }]);
});

test("setDocGroup: a document listed in ungrouped is taken out of that list when it gets a group", () => {
  const text = file({ ungrouped: [ENTRY, "app/x.md"] });
  const doc = JSON.parse(textOf(setDocGroup(text, GROUP))) as { ungrouped?: string[]; groups?: unknown };
  assert.deepEqual(doc.ungrouped, ["app/x.md"]);
  assert.deepEqual(doc.groups, [{ name: "Launch", match: [ENTRY] }]);
});

test("setDocGroup: a group the owner left with an empty list stays", () => {
  const text = file({ groups: [{ name: "Empty", match: [] }] });
  // Only a group this change emptied may go; the owner's own empty group is theirs to remove.
  assert.deepEqual(groupsOf(setDocGroup(text, GROUP)), [{ name: "Empty", match: [] }, { name: "Launch", match: [ENTRY] }]);
});

test("setDocGroup: moving a document into the group it is already in is refused as nothing to change", () => {
  const text = file({ groups: [{ name: "Launch", match: [ENTRY] }] });
  assert.equal(reasonOf(setDocGroup(text, GROUP)), "none");
});

test("setDocGroup: an earlier group whose pattern still claims the document makes the change refused as shadowed", () => {
  const text = file({ groups: [{ name: "Everything", match: ["app/**"] }] });
  // The new group would sit after the broad one, so the board would never place the document in it.
  assert.equal(reasonOf(setDocGroup(text, GROUP)), "shadowed");
});

test("setDocGroup: entries that are not strings are kept and never claim a document", () => {
  const text = file({ groups: [{ name: "Odd", match: [5] }] });
  assert.deepEqual(groupsOf(setDocGroup(text, GROUP)), [{ name: "Odd", match: [5] }, { name: "Launch", match: [ENTRY] }]);
});

test("setDocGroup: other keys of the file stay, and CRLF line ends and indent are kept", () => {
  const text = '{\r\n    "version": 2,\r\n    "note": "keep"\r\n}\r\n';
  const out = textOf(setDocGroup(text, GROUP));
  assert.equal(JSON.parse(out).note, "keep");
  assert.equal(JSON.parse(out).version, 2);
  assert.ok(out.includes('\r\n    "note"'), "four-space indent kept");
  assert.equal(/(?<!\r)\n/.test(out), false, "no bare line feed");
  assert.ok(out.endsWith("}\r\n"));
});

// --- applyRuleRow ---

const target = (over: Partial<PatchTarget> = {}): PatchTarget => ({ id: "app:docs/a.md", title: "A", project: "app", path: "docs/a.md", status: "amber", needs: [], ...over });
const row = (change: Partial<PatchChange> & Pick<PatchChange, "op">): PatchRow => ({ change: { item: "app:docs/a.md", reason: "", ...change }, before: "", after: "", stale: false });
const cat = (status: string, over: Partial<RuleCategory> = {}): RuleCategory => ({ status: status as RuleCategory["status"], label: status, ...over });

test("applyRuleRow: a severity change writes one entry for the exact document", () => {
  const out = textOf(applyRuleRow(undefined, row({ op: "setSeverity", to: "high" }), target(), []));
  assert.deepEqual(JSON.parse(out).severityOverrides, [{ project: "app", path: "docs/a.md", severity: "high" }]);
});

test("applyRuleRow: a severity that is not a level, or a path with a wildcard, is refused as a glob problem", () => {
  assert.equal(reasonOf(applyRuleRow(undefined, row({ op: "setSeverity", to: "urgent" }), target(), [])), "glob");
  assert.equal(reasonOf(applyRuleRow(undefined, row({ op: "setSeverity", to: "low" }), target({ path: "docs/*.md" }), [])), "glob");
});

test("applyRuleRow: a group change writes the group entry for the document", () => {
  const out = applyRuleRow(undefined, row({ op: "setGroup", group: "Launch" }), target(), []);
  assert.deepEqual(groupsOf(out), [{ name: "Launch", match: [ENTRY] }]);
});

test("applyRuleRow: a status change uses the plainest category of that state", () => {
  // The kind category comes first on purpose: the one without kind and note must still be chosen.
  const out = textOf(applyRuleRow(undefined, row({ op: "setStatus", to: "green" }), target(), [cat("green", { kind: "bug" }), cat("amber"), cat("green")]));
  const rule = JSON.parse(out).ruleSets["my-overrides"].rules[0];
  assert.deepEqual(rule, { id: "status-docs-a-md", when: { path: "docs/a.md", project: "app" }, set: { status: "green", final: true } });
});

test("applyRuleRow: when every category of the state has a kind, the first one is used", () => {
  const out = textOf(applyRuleRow(undefined, row({ op: "setStatus", to: "green" }), target(), [cat("green", { kind: "bug" }), cat("green", { kind: "task" })]));
  assert.equal(JSON.parse(out).ruleSets["my-overrides"].rules[0].set.kind, "bug");
});

test("applyRuleRow: a status no existing rule sets is refused as a status problem", () => {
  assert.equal(reasonOf(applyRuleRow(undefined, row({ op: "setStatus", to: "green" }), target(), [cat("amber")])), "status");
  assert.equal(reasonOf(applyRuleRow(undefined, row({ op: "setStatus", to: "green" }), target(), [])), "status");
});

test("applyRuleRow: a status rule goes first into the project's own rules, with a fresh id when one is taken", () => {
  const text = file({ projects: [{ id: "app", rules: [{ id: "status-docs-a-md" }] }] });
  const out = textOf(applyRuleRow(text, row({ op: "setStatus", to: "green" }), target(), [cat("green")]));
  const rules = JSON.parse(out).projects[0].rules;
  // First in the list so it wins over the rule that placed the document.
  assert.equal(rules[0].id, "status-docs-a-md-2");
  assert.equal(rules[1].id, "status-docs-a-md");
});

// --- addNeedsLine ---

test("addNeedsLine: a target is appended to an existing Needs line", () => {
  assert.deepEqual(addNeedsLine("# T\n\nNeeds: a.md\n\nBody\n", "b.md"), { ok: true, text: "# T\n\nNeeds: a.md, b.md\n\nBody\n" });
});

test("addNeedsLine: a target already listed is refused as none, plain or as a Markdown link", () => {
  assert.deepEqual(addNeedsLine("Needs: a.md, b.md\n", "b.md"), { ok: false, reason: "none" });
  assert.deepEqual(addNeedsLine("Needs: [A](a.md)\n", "a.md"), { ok: false, reason: "none" });
});

test("addNeedsLine: a link in the line is read as its target, so another target is appended after it", () => {
  assert.deepEqual(addNeedsLine("Needs: [A](a.md)\n", "b.md"), { ok: true, text: "Needs: [A](a.md), b.md\n" });
});

test("addNeedsLine: bold lead-in and trailing spaces are kept in place", () => {
  assert.deepEqual(addNeedsLine("**Needs:** a.md\n", "b.md"), { ok: true, text: "**Needs:** a.md, b.md\n" });
  // The trailing spaces stay after the new text, where they were.
  assert.deepEqual(addNeedsLine("Needs: a.md  \n", "b.md"), { ok: true, text: "Needs: a.md, b.md  \n" });
});

test("addNeedsLine: an existing line keeps its CRLF ending", () => {
  assert.deepEqual(addNeedsLine("# T\r\n\r\nNeeds: a.md\r\n", "b.md"), { ok: true, text: "# T\r\n\r\nNeeds: a.md, b.md\r\n" });
});

test("addNeedsLine: with no Needs line a new one goes under the title", () => {
  assert.deepEqual(addNeedsLine("# Title\n\nBody\n", "x.md"), { ok: true, text: "# Title\n\nNeeds: x.md\n\nBody\n" });
});

test("addNeedsLine: a title directly followed by text gets a blank line after the new line", () => {
  assert.deepEqual(addNeedsLine("# Title\nBody\n", "x.md"), { ok: true, text: "# Title\n\nNeeds: x.md\n\nBody\n" });
});

test("addNeedsLine: without a title the line goes at the top", () => {
  assert.deepEqual(addNeedsLine("Body\n", "x.md"), { ok: true, text: "Needs: x.md\n\nBody\n" });
});

test("addNeedsLine: with front matter the line goes under the title after it", () => {
  const out = addNeedsLine("---\ntitle: t\n---\n# Title\n\nBody\n", "x.md");
  assert.deepEqual(out, { ok: true, text: "---\ntitle: t\n---\n# Title\n\nNeeds: x.md\n\nBody\n" });
});

test("addNeedsLine: an unclosed front matter fence is not skipped", () => {
  const out = addNeedsLine("---\nBody\n", "x.md");
  // No closing fence means the opening line is ordinary text, so the new line goes above it.
  assert.deepEqual(out, { ok: true, text: "Needs: x.md\n\n---\nBody\n" });
});

test("addNeedsLine: CRLF text gets a new line with CRLF endings", () => {
  assert.deepEqual(addNeedsLine("# Title\r\n\r\nBody\r\n", "x.md"), { ok: true, text: "# Title\r\n\r\nNeeds: x.md\r\n\r\nBody\r\n" });
});

test("addNeedsLine: text without a final line break gets none added", () => {
  assert.deepEqual(addNeedsLine("# Title\nBody", "x.md"), { ok: true, text: "# Title\n\nNeeds: x.md\n\nBody" });
});

test("addNeedsLine: empty text becomes a Needs line", () => {
  assert.deepEqual(addNeedsLine("", "x.md"), { ok: true, text: "Needs: x.md\n\n" });
});

test("addNeedsLine: a Needs line inside a code fence is not edited, a new one is added", () => {
  const out = addNeedsLine("# T\n\n```\nNeeds: z.md\n```\n", "x.md");
  assert.deepEqual(out, { ok: true, text: "# T\n\nNeeds: x.md\n\n```\nNeeds: z.md\n```\n" });
});

test("addNeedsLine: a line longer than the read limit is not taken as a Needs line", () => {
  const long = "Needs: " + "a".repeat(2100) + "\n";
  // Reading very long lines is skipped to keep the match cheap, so the line is left as it was.
  assert.deepEqual(addNeedsLine(long, "x.md"), { ok: true, text: "Needs: x.md\n\n" + long });
});

// --- removeNeedsLine ---

const removed = (text: string, targets: string[]): string => {
  const e = removeNeedsLine(text, targets);
  assert.equal(e.ok, true);
  return (e as Extract<typeof e, { ok: true }>).text;
};

test("removeNeedsLine: one target of several is taken out and the rest are rejoined", () => {
  assert.equal(removed("Needs: a.md, b.md\n", ["a.md"]), "Needs: b.md\n");
  assert.equal(removed("Needs: a.md; b.md; c.md", ["b.md"]), "Needs: a.md, c.md");
});

test("removeNeedsLine: a line left with no target is removed whole, its neighbors stay", () => {
  assert.equal(removed("# T\n\nNeeds: a.md\n\nBody\n", ["a.md"]), "# T\n\n\nBody\n");
});

test("removeNeedsLine: a Markdown link and an 'and' list are read as targets", () => {
  assert.equal(removed("Needs: [A](a.md) and b.md\n", ["a.md"]), "Needs: b.md\n");
  assert.equal(removed("Needs: a.md.\n**Body**\n", ["a.md"]), "**Body**\n");
});

test("removeNeedsLine: every Needs line outside fences is edited", () => {
  assert.equal(removed("Needs: a.md\nNeeds: a.md, b.md\n", ["a.md"]), "Needs: b.md\n");
});

test("removeNeedsLine: bold lead-in and CRLF endings survive", () => {
  assert.equal(removed("**Needs:** a.md, b.md\n", ["a.md"]), "**Needs:** b.md\n");
  assert.equal(removed("Needs: a.md, b.md\r\n", ["a.md"]), "Needs: b.md\r\n");
});

test("removeNeedsLine: a cross-project target is matched by its project-prefixed spelling", () => {
  assert.equal(removed("Needs: lib:c.md, d.md\n", ["lib:c.md"]), "Needs: d.md\n");
});

test("removeNeedsLine: nothing named is refused as none and the text is not rewritten", () => {
  assert.deepEqual(removeNeedsLine("Needs: a.md\n", ["z.md"]), { ok: false, reason: "none" });
  assert.deepEqual(removeNeedsLine("No such line\n", ["a.md"]), { ok: false, reason: "none" });
  assert.deepEqual(removeNeedsLine("Needs: a.md\n", []), { ok: false, reason: "none" });
});

test("removeNeedsLine: a Needs line inside a code fence is left alone", () => {
  assert.deepEqual(removeNeedsLine("```\nNeeds: a.md\n```\n", ["a.md"]), { ok: false, reason: "none" });
});

// --- needsWrite / needsSpellings ---

const from = target();
const same = target({ id: "app:b.md", path: "b.md" });
const other = target({ id: "lib:c.md", project: "lib", path: "c.md" });

test("needsWrite: the path alone inside one project, project and path across projects", () => {
  assert.equal(needsWrite(from, same), "b.md");
  assert.equal(needsWrite(from, other), "lib:c.md");
});

test("needsSpellings: inside a project both spellings count, across projects only the prefixed one", () => {
  assert.deepEqual(needsSpellings(from, same), ["app:b.md", "b.md"]);
  assert.deepEqual(needsSpellings(from, other), ["lib:c.md"]);
});

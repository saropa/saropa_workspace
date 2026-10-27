// Future tab, header block: reading it (including malformed blocks) and writing it. The
// writer must change only block lines and keep every other byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlock, parseValue, setBlockFields } from "../../board/futureBlock";

test("a full block under the title is read field by field", () => {
  const text = "# Title\n\nImportance: build-next\nResearch: needed\nWow: 4\nReach: daily\nEffort: M\nRisk: low\nBlocker: none yet\n\nBody\n";
  assert.deepEqual(parseBlock(text), { importance: "build-next", wow: 4, reach: "daily", effort: "M", risk: "low", blocker: "none yet", invalid: [] });
});

test("a block on the first line, with or without front matter, is read", () => {
  assert.deepEqual(parseBlock("Wow: 2\nRisk: high\n\n# T\n"), { wow: 2, risk: "high", invalid: [] });
  assert.deepEqual(parseBlock("---\ntitle: x\n---\nEffort: XL\n\n# T\n"), { effort: "XL", invalid: [] });
  assert.deepEqual(parseBlock("---\ntitle: x\n---\n# T\n\nReach: rare\n"), { reach: "rare", invalid: [] });
});

test("keys and values are case-insensitive and flags may use spaces", () => {
  assert.deepEqual(parseBlock("# T\n\nimportance: Build Next\nWOW: 5\nreach: Weekly\neffort: xl\nRISK: Medium\n"), {
    importance: "build-next",
    wow: 5,
    reach: "weekly",
    effort: "XL",
    risk: "medium",
    invalid: [],
  });
  assert.equal(parseBlock("# T\n\nImportance: needs_decision\n").importance, "needs-decision");
});

test("malformed values leave the field unset and are listed in order", () => {
  const b = parseBlock("# T\n\nImportance: soon\nWow: 9\nReach: sometimes\nEffort: huge\nRisk: low\nBlocker:\n");
  assert.deepEqual(b, { risk: "low", invalid: ["Importance", "Wow", "Reach", "Effort", "Blocker"] });
  assert.deepEqual(parseBlock("# T\n\nWow: 0\n").invalid, ["Wow"]);
  assert.deepEqual(parseBlock("# T\n\nWow: 3.5\n").invalid, ["Wow"]);
  assert.deepEqual(parseBlock("# T\n\nWow: 4/5\n").invalid, ["Wow"]);
});

test("the first line of a repeated key wins", () => {
  assert.deepEqual(parseBlock("# T\n\nWow: 2\nWow: 5\n"), { wow: 2, invalid: [] });
});

test("a document with no block, or a block lower down, reads as empty", () => {
  assert.deepEqual(parseBlock(""), { invalid: [] });
  assert.deepEqual(parseBlock("# T\n\nSome text.\n\nWow: 4\n"), { invalid: [] });
  assert.deepEqual(parseBlock("# T\n\nBody\n"), { invalid: [] });
});

test("a prose line right under the title that starts with a key counts as the block", () => {
  assert.deepEqual(parseBlock("# T\n\nRisk: this may lose data\n"), { invalid: ["Risk"] });
});

test("a long blocker is cut to 300 characters; a byte order mark is ignored", () => {
  assert.equal(parseBlock(`# T\n\nBlocker: ${"x".repeat(400)}\n`).blocker?.length, 300);
  assert.deepEqual(parseBlock("﻿# T\n\nWow: 3\n"), { wow: 3, invalid: [] });
  assert.deepEqual(parseBlock("﻿Wow: 3\n"), { wow: 3, invalid: [] });
});

test("unicode text in the title and the blocker is kept", () => {
  assert.equal(parseBlock("# Größe ✨ 日本語\n\nBlocker: kein API für Haptik ✓\n").blocker, "kein API für Haptik ✓");
});

test("parseValue answers per key", () => {
  assert.equal(parseValue("Wow", "5"), 5);
  assert.equal(parseValue("Wow", "6"), undefined);
  assert.equal(parseValue("Effort", "l"), "L");
  assert.equal(parseValue("Importance", "Marketable"), "marketable");
  assert.equal(parseValue("Research", "needed"), "needed");
  assert.equal(parseValue("Blocker", "  "), undefined);
});

test("an existing value is replaced and every other byte stays", () => {
  const text = "# T\n\nImportance: marketable\nWow: 2\n\nBody text\n";
  assert.equal(setBlockFields(text, { Importance: "build-next" }), "# T\n\nImportance: build-next\nWow: 2\n\nBody text\n");
});

test("the spelling of the key is kept when its value is replaced", () => {
  assert.equal(setBlockFields("# T\n\nwow: 2\n", { Wow: "5" }), "# T\n\nwow: 5\n");
  assert.equal(setBlockFields("# T\n\nWow :   2   \n", { Wow: "4" }), "# T\n\nWow: 4\n");
});

test("a missing key is added at the end of the existing block", () => {
  const text = "# T\n\nImportance: marketable\nWow: 2\n\nBody\n";
  assert.equal(setBlockFields(text, { Reach: "daily" }), "# T\n\nImportance: marketable\nWow: 2\nReach: daily\n\nBody\n");
});

test("null removes the line; removing a key that is not there changes nothing", () => {
  const text = "# T\n\nImportance: not-feasible\nBlocker: no API\n\nBody\n";
  assert.equal(setBlockFields(text, { Blocker: null }), "# T\n\nImportance: not-feasible\n\nBody\n");
  assert.equal(setBlockFields("# T\n\nWow: 2\n", { Blocker: null }), "# T\n\nWow: 2\n");
  assert.equal(setBlockFields("# T\n\nBody\n", { Blocker: null }), "# T\n\nBody\n");
});

test("a new block goes under the title, in the fixed key order", () => {
  assert.equal(setBlockFields("# T\n\nBody\n", { Wow: "3", Importance: "nice-to-have" }), "# T\n\nImportance: nice-to-have\nWow: 3\n\nBody\n");
});

test("a title with text on the next line gets a blank line on both sides of the block", () => {
  assert.equal(setBlockFields("# T\nBody\n", { Importance: "marketable" }), "# T\n\nImportance: marketable\n\nBody\n");
});

test("a document with no title gets the block at the top", () => {
  assert.equal(setBlockFields("Body\nmore\n", { Risk: "high" }), "Risk: high\n\nBody\nmore\n");
});

test("front matter stays first; the block follows the title or the front matter", () => {
  assert.equal(setBlockFields("---\ntitle: a\n---\nBody\n", { Wow: "1" }), "---\ntitle: a\n---\n\nWow: 1\n\nBody\n");
  assert.equal(setBlockFields("---\ntitle: a\n---\n# T\n\nBody\n", { Wow: "1" }), "---\ntitle: a\n---\n# T\n\nWow: 1\n\nBody\n");
});

test("a front matter fence with no closing line is plain text", () => {
  assert.equal(setBlockFields("---\nBody\n", { Wow: "1" }), "Wow: 1\n\n---\nBody\n");
});

test("CRLF documents get CRLF lines and keep every existing line ending", () => {
  assert.equal(setBlockFields("# T\r\n\r\nBody\r\n", { Importance: "marketable", Wow: "3" }), "# T\r\n\r\nImportance: marketable\r\nWow: 3\r\n\r\nBody\r\n");
  assert.equal(setBlockFields("# T\r\n\r\nWow: 2\r\nBody\r\n", { Wow: "5", Reach: "rare" }), "# T\r\n\r\nWow: 5\r\nReach: rare\r\nBody\r\n");
});

test("mixed line endings outside the block are untouched", () => {
  assert.equal(setBlockFields("# T\n\nWow: 2\nBody\r\nmore\r", { Wow: "5" }), "# T\n\nWow: 5\nBody\r\nmore\r");
});

test("a document without a final line ending keeps none", () => {
  assert.equal(setBlockFields("# T\n\nBody", { Wow: "3" }), "# T\n\nWow: 3\n\nBody");
  assert.equal(setBlockFields("# T", { Wow: "3" }), "# T\n\nWow: 3");
  assert.equal(setBlockFields("# T\n\nWow: 2", { Reach: "daily" }), "# T\n\nWow: 2\nReach: daily");
  assert.equal(setBlockFields("# T\n\nWow: 2\nRisk: low", { Risk: null }), "# T\n\nWow: 2");
});

test("an empty document becomes just the block", () => {
  assert.equal(setBlockFields("", { Importance: "marketable" }), "Importance: marketable\n");
});

test("a byte order mark stays at the very start", () => {
  assert.equal(setBlockFields("﻿# T\n\nBody\n", { Wow: "2" }), "﻿# T\n\nWow: 2\n\nBody\n");
  assert.equal(setBlockFields("﻿Wow: 2\n\nBody\n", { Wow: "4" }), "﻿Wow: 4\n\nBody\n");
  assert.equal(setBlockFields("﻿Body\n", { Wow: "4" }), "﻿Wow: 4\n\nBody\n");
});

test("unicode in the document and the value comes through unchanged", () => {
  const text = "# Größe ✨ 日本語\n\nText ünï 🎉\n";
  const next = setBlockFields(text, { Importance: "not-feasible", Blocker: "kein API für Haptik ✓" });
  assert.equal(next, "# Größe ✨ 日本語\n\nImportance: not-feasible\nBlocker: kein API für Haptik ✓\n\nText ünï 🎉\n");
  assert.equal(parseBlock(next).blocker, "kein API für Haptik ✓");
});

test("a value with line breaks is written on one line", () => {
  assert.equal(setBlockFields("# T\n\nBody\n", { Blocker: "a\r\nb\nc" }), "# T\n\nBlocker: a b c\n\nBody\n");
});

test("nothing to change, or only removals on a missing block, returns the same text", () => {
  const text = "# T\n\nBody\n";
  assert.equal(setBlockFields(text, {}), text);
  assert.equal(setBlockFields(text, { Blocker: null }), text);
});

test("writing the same change twice equals writing it once", () => {
  const once = setBlockFields("# T\n\nBody\n", { Importance: "marketable", Wow: "4" });
  assert.equal(setBlockFields(once, { Importance: "marketable", Wow: "4" }), once);
});

test("a written block reads back as written", () => {
  const next = setBlockFields("# T\n\nBody\n", { Importance: "needs-decision", Wow: "5", Reach: "weekly", Effort: "XL", Risk: "medium" });
  assert.deepEqual(parseBlock(next), { importance: "needs-decision", wow: 5, reach: "weekly", effort: "XL", risk: "medium", invalid: [] });
});

test("a Research line is kept as it is while other keys change", () => {
  const text = "# T\n\nResearch: needed\nWow: 2\n";
  assert.equal(setBlockFields(text, { Wow: "3" }), "# T\n\nResearch: needed\nWow: 3\n");
});

test("a malformed value is repaired by writing the key", () => {
  assert.equal(setBlockFields("# T\n\nWow: lots\n", { Wow: "4" }), "# T\n\nWow: 4\n");
});

// Unit tests for parseOlegShiloLines — the pure transform that turns an oleg-shilo
// "Favorites Manager" text list into ordered import entries. The store dispatch and
// pin creation need the extension host and are exercised manually (see the finish
// handoff); the genuinely subtle part — preserving source order and collapsing blank
// lines into section dividers — is pure string logic and pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOlegShiloLines, OlegShiloEntry } from "../import/favoritesImport";

// Compact a parsed entry to a stable token so a test asserts on order + kind without
// repeating the full object shape: "c:Text", "f:path|alias", "f:path", "sep", "skip".
function token(e: OlegShiloEntry): string {
  switch (e.kind) {
    case "comment":
      return `c:${e.text}`;
    case "separator":
      return "sep";
    case "skip":
      return "skip";
    case "file":
      return e.alias ? `f:${e.pathPart}|${e.alias}` : `f:${e.pathPart}`;
  }
}

const tokens = (text: string): string[] => parseOlegShiloLines(text).map(token);

test("a plain file/alias list parses in source order with no annotations", () => {
  // No regression: a list with no comments/dividers yields exactly the file entries.
  assert.deepEqual(tokens("a.py\nb.py|Build\nc.py"), ["f:a.py", "f:b.py|Build", "f:c.py"]);
});

test("a `#` line becomes a comment whose text is the line minus the marker", () => {
  assert.deepEqual(tokens("# Deploy scripts\ndeploy.sh"), ["c:Deploy scripts", "f:deploy.sh"]);
});

test("comments and file pins keep their interleaved source order", () => {
  const text = "# Section A\nfoo.py\nbar.py\n# Section B\nbaz.py";
  assert.deepEqual(tokens(text), ["c:Section A", "f:foo.py", "f:bar.py", "c:Section B", "f:baz.py"]);
});

test("a blank line between entries becomes a single separator", () => {
  assert.deepEqual(tokens("foo.py\n\nbar.py"), ["f:foo.py", "sep", "f:bar.py"]);
});

test("a run of blank lines collapses to one separator", () => {
  assert.deepEqual(tokens("foo.py\n\n\n\nbar.py"), ["f:foo.py", "sep", "f:bar.py"]);
});

test("a leading blank line emits no separator", () => {
  // A divider above the very first entry is noise, not sectioning.
  assert.deepEqual(tokens("\n\nfoo.py"), ["f:foo.py"]);
});

test("a trailing blank line (or trailing newline) emits no separator", () => {
  // The common case: a file that ends with a newline must not leave a dangling
  // divider past the last entry.
  assert.deepEqual(tokens("foo.py\n"), ["f:foo.py"]);
  assert.deepEqual(tokens("foo.py\n\n\n"), ["f:foo.py"]);
});

test("a divider before a comment is preserved (sections led by a heading)", () => {
  const text = "foo.py\n\n# Section B\nbar.py";
  assert.deepEqual(tokens(text), ["f:foo.py", "sep", "c:Section B", "f:bar.py"]);
});

test("an alias may itself contain a pipe — split on the first only", () => {
  assert.deepEqual(tokens("a.py|Build | release"), ["f:a.py|Build | release"]);
});

test("a path-less malformed line is a skip, not a divider", () => {
  // "|alias" has no path; it must surface as a reportable skip and must NOT count as
  // a blank divider (so a following blank still collapses normally).
  assert.deepEqual(tokens("foo.py\n|orphan\nbar.py"), ["f:foo.py", "skip", "f:bar.py"]);
});

test("CRLF line endings parse identically to LF", () => {
  assert.deepEqual(tokens("# A\r\nfoo.py\r\n\r\nbar.py"), ["c:A", "f:foo.py", "sep", "f:bar.py"]);
});

test("a bare `#` line is a comment with empty text", () => {
  assert.deepEqual(tokens("#\nfoo.py"), ["c:", "f:foo.py"]);
});

test("empty input yields no entries", () => {
  assert.deepEqual(tokens(""), []);
});

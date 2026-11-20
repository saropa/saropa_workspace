// Covers the phrase signals of link inference directly: the code stripper, the "waits on" pattern builder and
// phraseSignals over a real Resolver (negation, code, quoted titles, cross-project downgrade, caps, phrase subset).
// linksInfer.test.ts reaches these only through inferLinkProposals, so edge behavior is pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardPattern, phraseSignals, withoutCode } from "../../../board/org/linksPhrase";
import { LinkDoc, Resolver } from "../../../board/org/linksSignals";

const ld = (project: string, path: string, text = "", title = ""): LinkDoc => ({ project, path, title, text });
// Runs phraseSignals the way the engine does: one resolver over the same documents.
const run = (docs: LinkDoc[], phrases?: readonly string[]) => phraseSignals(docs, new Resolver(docs), phrases);
// Counts matches without touching the shared global pattern's lastIndex (the pattern is cached and reused).
const hits = (re: RegExp | undefined, text: string): number => (re ? [...text.matchAll(re)].length : 0);

test("withoutCode: a fenced block is blanked and line breaks stay", () => {
  const out = withoutCode("a\n```\nblocked by x.md\n```\nb");
  assert.equal(out, "a\n\n\n\nb");
});

test("withoutCode: an unclosed fence blanks everything to the end", () => {
  const out = withoutCode("a\n```\nblocked by x.md\nmore");
  assert.equal(out, "a\n\n\n");
});

test("withoutCode: a tilde fence is not closed by backticks", () => {
  const out = withoutCode("~~~\nx\n```\ny\n~~~");
  assert.equal(out.split("\n").length, 5);
  assert.ok(!/[xy]/.test(out));
});

test("withoutCode: an indented block after a blank line is blanked", () => {
  assert.equal(withoutCode("para\n\n    code line\nafter"), "para\n\n\nafter");
});

test("withoutCode: an indented line that continues a paragraph is kept", () => {
  assert.equal(withoutCode("para\n    continued"), "para\n    continued");
});

test("withoutCode: an inline span is replaced by a space", () => {
  assert.equal(withoutCode("see `foo()` now"), "see   now");
});

test("withoutCode: an inline span that is a Markdown file name stays", () => {
  assert.equal(withoutCode("see `docs/a.md` now"), "see `docs/a.md` now");
});

test("forwardPattern: the default reads the shipped phrases case-insensitively", () => {
  const re = forwardPattern();
  assert.equal(hits(re, "Blocked by x, depends on y, waiting on z"), 3);
});

test("forwardPattern: 'needs' followed by a colon is a heading, not a phrase", () => {
  const re = forwardPattern();
  assert.equal(hits(re, "Needs: foo"), 0);
  assert.equal(hits(re, "needs foo"), 1);
});

test("forwardPattern: an empty or blank phrase list gives no pattern", () => {
  assert.equal(forwardPattern([]), undefined);
  assert.equal(forwardPattern(["   "]), undefined);
});

test("forwardPattern: a custom phrase is escaped and matches across any run of spaces", () => {
  const re = forwardPattern(["gated by", "a.b"]);
  assert.equal(hits(re, "gated   by x"), 1);
  assert.equal(hits(re, "axb"), 0);
  assert.equal(hits(re, "a.b"), 1);
});

test("forwardPattern: a shipped name reads its plural and tense forms", () => {
  const re = forwardPattern(["requires"]);
  assert.equal(hits(re, "require x"), 1);
  assert.equal(hits(re, "requires x"), 1);
});

test("forwardPattern: the same phrase list returns the same cached pattern", () => {
  assert.equal(forwardPattern(["gated by"]), forwardPattern(["gated by"]));
});

test("phraseSignals: 'blocked by' a named file is a high edge from this document to that one", () => {
  const out = run([ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].from, 0);
  assert.equal(out[0].to, 1);
  assert.equal(out[0].signal, "phrase");
  assert.equal(out[0].confidence, "high");
  assert.deepEqual(out[0].why, { key: "releaseBoard.linkWhy.phrase", params: { phrase: "blocked by", target: "b.md" } });
});

test("phraseSignals: a weaker phrase ('after') is medium", () => {
  const out = run([ld("p", "a.md", "Do this after b.md"), ld("p", "b.md")]);
  assert.equal(out[0].confidence, "medium");
});

test("phraseSignals: a heading 'Needs:' makes no edge", () => {
  assert.deepEqual(run([ld("p", "a.md", "Needs: b.md"), ld("p", "b.md")]), []);
});

test("phraseSignals: a negated phrase makes no edge", () => {
  const docs = [ld("p", "a.md", "No longer depends on b.md\nnot blocked by b.md"), ld("p", "b.md")];
  assert.deepEqual(run(docs), []);
});

test("phraseSignals: a phrase inside a code fence makes no edge", () => {
  assert.deepEqual(run([ld("p", "a.md", "```\nblocked by b.md\n```"), ld("p", "b.md")]), []);
});

test("phraseSignals: 'X blocks this' points this document at X", () => {
  const out = run([ld("p", "a.md", "b.md blocks this"), ld("p", "b.md")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].from, 0);
  assert.equal(out[0].to, 1);
  assert.equal(out[0].why.params.phrase, "blocks this");
});

test("phraseSignals: 'this blocks X' points X at this document", () => {
  const out = run([ld("p", "a.md", "This blocks b.md"), ld("p", "b.md")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].from, 1);
  assert.equal(out[0].to, 0);
  assert.equal(out[0].why.params.phrase, "this blocks");
});

test("phraseSignals: a quoted title resolves within the project and is one step weaker", () => {
  const out = run([ld("p", "a.md", 'Blocked by "Beta plan"'), ld("p", "b.md", "", "Beta plan")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 1);
  assert.equal(out[0].confidence, "medium");
});

test("phraseSignals: a name that matches no document, or only the document itself, makes no edge", () => {
  assert.deepEqual(run([ld("p", "a.md", "Blocked by missing.md")]), []);
  assert.deepEqual(run([ld("p", "a.md", "Blocked by a.md")]), []);
});

test("phraseSignals: a document found only in another project is one step weaker", () => {
  const out = run([ld("p", "a.md", "Blocked by c.md"), ld("q", "c.md")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 1);
  assert.equal(out[0].confidence, "medium");
});

test("phraseSignals: a list of names after one phrase gives one edge each", () => {
  const out = run([ld("p", "a.md", "Blocked by b.md and c.md"), ld("p", "b.md"), ld("p", "c.md")]);
  assert.deepEqual(out.map((c) => c.to).sort(), [1, 2]);
});

test("phraseSignals: one document gives at most ten edges", () => {
  const text = Array.from({ length: 12 }, () => "Blocked by b.md").join("\n");
  assert.equal(run([ld("p", "a.md", text), ld("p", "b.md")]).length, 10);
});

test("phraseSignals: only the phrases passed in are read", () => {
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")];
  assert.deepEqual(run(docs, ["after"]), []);
  assert.equal(run([ld("p", "a.md", "Do it after b.md"), ld("p", "b.md")], ["after"]).length, 1);
});

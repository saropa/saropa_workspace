// Shared page helpers: escaping, placeholder filling, live lines and the placeholder filler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, escapeHtml, fill, liveLine, pillify } from "../../board/boardHtmlUtil";

const t = new Proxy({} as BoardStrings, {
  get: (_o, k: string) =>
    k === "liveLogs" ? "logs {errors}e {warnings}w {crashes}c" : k === "liveProblems" ? "problems {errors}e {warnings}w" : k === "liveLints" ? "lints {errors}e {warnings}w" : `[${k}]`,
});

test("escapeHtml turns every markup character into a numeric reference", () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&#60;a href=&#34;x&#34; title=&#39;y&#39;&#62;&#38;&#60;/a&#62;");
});

test("escapeHtml leaves plain text alone and escapes an ampersand every time", () => {
  assert.equal(escapeHtml("plain text 123"), "plain text 123");
  assert.equal(escapeHtml("&#38;"), "&#38;#38;");
  assert.equal(escapeHtml(""), "");
});

test("fill replaces known placeholders and keeps unknown ones", () => {
  assert.equal(fill("{count} of {total}", { count: 3 }), "3 of {total}");
  assert.equal(fill("{a}{a}", { a: "x" }), "xx");
  assert.equal(fill("{gone}", { gone: undefined }), "{gone}");
});

test("fill escapes the template and the values, so a title can never add markup", () => {
  assert.equal(fill("<b>{title}</b>", { title: "<script>alert(1)</script>" }), "&#60;b&#62;&#60;script&#62;alert(1)&#60;/script&#62;&#60;/b&#62;");
});

test("liveLine names the file and each source that has counts", () => {
  const line = liveLine({ file: "lib/a.dart", logs: { errors: 2, warnings: 1, crashes: 3 }, problems: { errors: 4, warnings: 0 } }, t);
  assert.equal(line, "lib/a.dart: logs 2e 1w 3c; problems 4e 0w");
});

test("liveLine fills a missing crash count with zero and skips sources without counts", () => {
  assert.equal(liveLine({ file: "x.ts", lints: { errors: 0, warnings: 5 } }, t), "x.ts: lints 0e 5w");
  assert.equal(liveLine({ file: "x.ts" }, t), "x.ts: ");
});

test("pillify wraps a whole number and leaves words, versions, decimals and entities alone", () => {
  const P = (n: string): string => `<span class="pill" title="pillTip">${n}</span>`;
  assert.equal(pillify(t, "3 more steps"), `${P("3")} more steps`);
  assert.equal(pillify(t, "App: 12 new, 4 cleared."), `App: ${P("12")} new, ${P("4")} cleared.`);
  assert.equal(pillify(t, "v1.2.3 and 4.5 and a1 and 2b"), "v1.2.3 and 4.5 and a1 and 2b");
  assert.equal(pillify(t, "&#60;b&#62; 7"), `&#60;b&#62; ${P("7")}`);
  assert.equal(pillify(t, "ends with 5."), `ends with ${P("5")}.`);
  assert.equal(pillify(t, "1..5"), "1..5");
});

test("pillify takes linear time on text built to defeat a backtracking pattern", () => {
  const nasty = "1.".repeat(40000) + "x " + "9".repeat(40000) + "a" + ".1".repeat(40000);
  const start = Date.now();
  pillify(t, nasty);
  assert.ok(Date.now() - start < 10000, "a long run of digits and dots is handled in one pass");
});

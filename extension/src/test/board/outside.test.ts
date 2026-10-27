// Sessions, review requests and groups from other extensions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCount, cleanGroup, cleanItems, emptyOutside, parseReviewRequests, safeUrl } from "../../board/outside";
import { buildBoard } from "../../board/boardModel";
import { renderBoard } from "../../board/boardHtml";
import { BoardConfig, Classified } from "../../board/types";

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", path: "/app", roots: ["bugs"], ruleSets: [] }] };
const row = (path: string, status: Classified["status"]): Classified => ({ project: "app", path, status, kind: "", note: "" });

test("only https links survive", () => {
  assert.equal(safeUrl("https://github.com/a/b/pull/1"), "https://github.com/a/b/pull/1");
  for (const bad of ["http://x.com", "javascript:alert(1)", "file:///etc/passwd", "vscode://x", "not a url", 5, undefined]) {
    assert.equal(safeUrl(bad), undefined);
  }
});

test("items from other extensions are cleaned and capped", () => {
  const raw = [{ title: " A\nB ", detail: 7, url: "http://x" }, { title: "" }, "junk", null, ...Array.from({ length: 40 }, (_, i) => ({ title: "t" + i }))];
  const out = cleanItems(raw);
  assert.equal(out.length, 20);
  assert.deepEqual(out[0], { title: "A B", detail: undefined, url: undefined });
  assert.deepEqual(cleanItems("nope"), []);
});

test("a group needs an id, a label and at least one item", () => {
  assert.equal(cleanGroup("a", "A", []), undefined);
  assert.equal(cleanGroup("", "A", [{ title: "x" }]), undefined);
  assert.equal(cleanGroup("a", "A", [{ title: "x" }])?.items.length, 1);
});

test("review requests read title, repository and number", () => {
  const out = parseReviewRequests({ items: [{ title: "Fix it", number: 7, html_url: "https://github.com/saropa/x/pull/7", repository_url: "https://api.github.com/repos/saropa/x" }, { number: 1 }] });
  assert.deepEqual(out, [{ title: "Fix it", detail: "saropa/x#7", url: "https://github.com/saropa/x/pull/7" }]);
  assert.deepEqual(parseReviewRequests(null), []);
});

test("a chat count is a positive number from a reply that finished indexing", () => {
  assert.equal(chatCount({ indexing: false, total: 3 }), 3);
  assert.equal(chatCount({ indexing: true, total: 3 }), undefined);
  assert.equal(chatCount({ indexing: false, total: 0 }), undefined);
  assert.equal(chatCount("x"), undefined);
  assert.equal(chatCount(null), undefined);
});

test("counts land on open documents; outside groups never change a light", () => {
  const outside = { chats: { "app/bugs/A.md": 2 }, groups: [{ id: "g", label: "Review", items: [{ title: "PR", url: "https://github.com/a/b/pull/1" }] }] };
  const without = buildBoard(cfg, [row("bugs/A.md", "amber")], undefined, true);
  const withOut = buildBoard(cfg, [row("bugs/A.md", "amber")], undefined, true, undefined, undefined, undefined, { outside });
  assert.equal(withOut.items[0].chats, 2);
  assert.equal(without.items[0].chats, undefined);
  assert.equal(withOut.projects[0].light, without.projects[0].light);
  assert.deepEqual(buildBoard(cfg, [], undefined, true).outside, []);
  assert.deepEqual(emptyOutside(), { chats: {}, groups: [] });
});

test("the page shows the session count and the outside group, escaped, with links only by index", () => {
  const t = new Proxy({}, { get: (_o, k: string) => `[${k}]` }) as never;
  const outside = { chats: { "app/bugs/A.md": 2 }, groups: [{ id: "g", label: "Review <b>", items: [{ title: "<img src=x>", url: "https://github.com/a/b/pull/1" }] }] };
  const m = buildBoard(cfg, [row("bugs/A.md", "amber")], undefined, true, undefined, undefined, undefined, { outside });
  const html = renderBoard(m, t, "n");
  assert.ok(html.includes('<span class="pill" title="chatsPill">2</span>'));
  assert.ok(!html.includes("<img src=x>") && !html.includes("<b>Review"));
  assert.ok(html.includes('data-g="0" data-i="0"'));
  const attrs = [...html.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(attrs.every((a) => a !== "https://github.com/a/b/pull/1"), "the page never carries the link");
  assert.equal(/\bhref\s*=\s*"(?!#")/i.test(html), false, "the page has no href but the in-page #");
});

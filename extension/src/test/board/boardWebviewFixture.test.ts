// Tests for the board webview test fixture. Five page tests build on it, so a helper that silently
// stopped doing its job (a mirrored attribute, an ARIA check that never fails) would let those tests pass
// against a page that is wrong. These pin what each helper promises.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, REV, ariaProblems, fill, ids, isChecked, isHidden, keyWith, openBoardPage, openInlineScriptPage, setChecked, t } from "./boardWebviewFixture";

test("the fixture exposes the real English strings and a fixed revision", () => {
  assert.equal(typeof t, "object");
  assert.equal(Object.keys(t).length > 0, true);
  assert.equal(REV, 7);
});

test("EVIL carries every character that breaks out of markup, an attribute or a script", () => {
  for (const piece of ["<", ">", "\"", "'", "&", "</script>", "<!--"]) {
    assert.equal(EVIL.includes(piece), true, `missing ${piece}`);
  }
});

test("fill replaces every occurrence of a placeholder and leaves unknown ones alone", () => {
  assert.equal(fill("{n} of {n} in {where}", { n: 3, where: "board" }), "3 of 3 in board");
  assert.equal(fill("keep {other}", { n: 1 }), "keep {other}");
  assert.equal(fill("", { n: 1 }), "");
});

test("openBoardPage runs the prelude: the revision, the recorders and wired are in the page scope", () => {
  const page = openBoardPage(`<p class="a">x</p><p class="a">y</p>`);
  assert.equal(page.evalJson("REV"), REV);
  page.run("sitSend({k:1}); showTab('tags'); window.__n = 0; wired('.a', function(){ window.__n += 1; });", "t.js");
  assert.deepEqual(page.evalJson("SITCALLS"), [{ k: 1 }]);
  assert.deepEqual(page.evalJson("SHOWTAB"), ["tags"]);
  assert.equal(page.evalJson("window.__n"), 2);
});

test("openBoardPage mirrors hidden and disabled attributes onto the properties the scripts read", () => {
  const page = openBoardPage(`<div id="h" hidden></div><button id="d" disabled>x</button><button id="e">y</button>`);
  assert.equal(isHidden(page.byId("h")), true);
  assert.equal(page.byId("d").disabled, true);
  assert.equal(page.byId("e").disabled, false);
  assert.equal(isHidden(page.byId("e")), false);
});

test("isHidden prefers the property a script set over the markup attribute", () => {
  const page = openBoardPage(`<div id="h" hidden></div><div id="v"></div>`);
  (page.byId("h") as unknown as { hidden: boolean }).hidden = false;
  (page.byId("v") as unknown as { hidden: boolean }).hidden = true;
  assert.equal(isHidden(page.byId("h")), false);
  assert.equal(isHidden(page.byId("v")), true);
});

// The fixture patches these onto the fake element at run time, so the FakeElement type does not
// declare them; this view types just what the test reads, without editing the fake DOM.
interface PatchedElement {
  previousElementSibling: PatchedElement | null;
  nextElementSibling: PatchedElement | null;
  isConnected: boolean;
  getAttribute(name: string): string | null;
}
const patched = (el: unknown): PatchedElement => el as PatchedElement;

test("the patched fake DOM gives sibling links, connection state and the no-op calls the page modules use", () => {
  const page = openBoardPage(`<ul id="l"><li id="a"></li><li id="b"></li><li id="c"></li></ul>`);
  const b = page.byId("b");
  assert.equal(patched(b).previousElementSibling?.getAttribute("id"), "a");
  assert.equal(patched(b).nextElementSibling?.getAttribute("id"), "c");
  assert.equal(patched(page.byId("a")).previousElementSibling, null);
  assert.equal(patched(page.byId("c")).nextElementSibling, null);
  assert.equal(patched(b).isConnected, true);
  const loose = page.document.createElement("div");
  assert.equal(patched(loose).isConnected, false);
  page.byId("l").appendChild(loose);
  assert.equal(patched(loose).isConnected, true);
  assert.doesNotThrow(() => (b as unknown as { scrollIntoView: () => void }).scrollIntoView());
  assert.doesNotThrow(() => (b as unknown as { select: () => void }).select());
  assert.equal(typeof (page.document as unknown as { createDocumentFragment: () => unknown }).createDocumentFragment(), "object");
});

test("openInlineScriptPage runs the page's nonce script after the markup is parsed and mirrored", () => {
  const html = `<!DOCTYPE html><html><body><div id="h" hidden></div><script nonce="abc">window.__seen = document.getElementById('h').hidden;</script></body></html>`;
  const page = openInlineScriptPage(html);
  // The script saw the mirrored property, so it ran after the mirror step, not before.
  assert.equal(page.evalJson("window.__seen"), true);
});

test("openInlineScriptPage refuses a page that has no nonce script", () => {
  assert.throws(() => openInlineScriptPage("<html><body><script>1</script></body></html>"), /no nonce script/);
});

test("keyWith sends a keydown that carries the key and the modifiers asked for, and none by default", () => {
  const page = openBoardPage(`<button id="b">x</button>`);
  const seen: Array<Record<string, unknown>> = [];
  page.byId("b").addEventListener("keydown", (e) => {
    const ev = e as unknown as Record<string, unknown>;
    seen.push({ key: ev.key, alt: ev.altKey, ctrl: ev.ctrlKey, shift: ev.shiftKey, meta: ev.metaKey });
  });
  keyWith(page, page.byId("b"), "ArrowDown");
  keyWith(page, page.byId("b"), "Enter", { ctrl: true, shift: true });
  assert.deepEqual(seen, [
    { key: "ArrowDown", alt: false, ctrl: false, shift: false, meta: false },
    { key: "Enter", alt: false, ctrl: true, shift: true, meta: false },
  ]);
});

test("setChecked and isChecked round-trip, and an element never set reads as not checked", () => {
  const page = openBoardPage(`<input id="c" type="checkbox">`);
  assert.equal(isChecked(page.byId("c")), false);
  setChecked(page.byId("c"), true);
  assert.equal(isChecked(page.byId("c")), true);
  setChecked(page.byId("c"), false);
  assert.equal(isChecked(page.byId("c")), false);
});

test("ids lists every id attribute in document order", () => {
  const page = openBoardPage(`<div id="x"></div><p>no id</p><span id="y"></span>`);
  assert.deepEqual(ids(page), ["x", "y"]);
});

test("ariaProblems is empty for a page whose references all resolve", () => {
  const page = openBoardPage(`<h2 id="t">Title</h2><div id="p"></div><button aria-controls="p" aria-labelledby="t">go</button><ul aria-owns="p t"></ul>`);
  assert.deepEqual(ariaProblems(page), []);
});

test("ariaProblems reports duplicate ids and every dangling reference, naming the element", () => {
  const page = openBoardPage(`<div id="d"></div><div id="d"></div><button aria-controls="gone">a</button><section aria-labelledby="d nowhere"></section><ul aria-owns="ghost"></ul>`);
  // Duplicates first, then each attribute in the checker's own order (labelledby, controls, owns).
  assert.deepEqual(ariaProblems(page), [
    "duplicate id d",
    `aria-labelledby="nowhere" on <section> has no target`,
    `aria-controls="gone" on <button> has no target`,
    `aria-owns="ghost" on <ul> has no target`,
  ]);
});

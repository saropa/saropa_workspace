// Tests for the fake DOM's selector engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSelectorList } from "./fakeDomSelect";
import { runPage } from "./fakeDom";

const PAGE = (script = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><title>t</title><style>.x { color: red; }</style></head>
<body class="dark">
<div id="root" class="a b"><p class="x" data-n="1">one &amp; two</p><p class="x y" data-n="2">three</p><br><input id="q" value="init"></div>
<button id="go" type="button">Go</button>
<script nonce="n">${script}</script>
</body></html>`;


test("a selector list parses into one chain per comma, with its combinators", () => {
  const parsed = parseSelectorList("ul > li.a:not(.b), [data-x='1'] span");
  assert.deepEqual(parsed.map((chain) => chain.map((p) => p.combinator + p.compound.length)), [[" 1", ">3"], [" 1", " 1"]]);
});

test("a selector the engine does not know is refused rather than ignored", () => {
  assert.throws(() => parseSelectorList("a:hover"), /unsupported selector/);
  assert.throws(() => parseSelectorList("a ~ b"), /unsupported selector/);
});

test("selectors: tag, class, id, attribute, :not, descendant, child and lists", () => {
  const page = runPage(PAGE());
  const texts = (sel: string): string[] => page.all(sel).map((e) => e.textContent);
  assert.deepEqual(texts("p.x.y"), ["three"]);
  assert.deepEqual(texts('[data-n="2"]'), ["three"]);
  assert.deepEqual(texts("[data-n]"), ["one & two", "three"]);
  assert.deepEqual(texts(".x:not(.y)"), ["one & two"]);
  assert.deepEqual(texts("#root p"), ["one & two", "three"]);
  assert.deepEqual(texts("body > button"), ["Go"]);
  assert.deepEqual(texts("#root > button"), []);
  assert.deepEqual(texts("button, .y"), ["three", "Go"]);
  assert.throws(() => page.all("p:first-child"), /unsupported selector/);
});

test("quoted attribute values may hold escaped quotes, backslashes and brackets", () => {
  const page = runPage(PAGE());
  const odd = page.document.createElement("span");
  odd.dataset.id = 'a"b\\c]d e';
  page.document.body.appendChild(odd);
  assert.equal(page.document.querySelector('[data-id="a\\"b\\\\c]d e"]'), odd);
});

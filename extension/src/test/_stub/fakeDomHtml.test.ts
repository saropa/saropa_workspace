// Tests for the fake DOM's HTML parser and serializer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, parseHtml, serializeNode } from "./fakeDomHtml";
import { runPage } from "./fakeDom";

const PAGE = (script = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><title>t</title><style>.x { color: red; }</style></head>
<body class="dark">
<div id="root" class="a b"><p class="x" data-n="1">one &amp; two</p><p class="x y" data-n="2">three</p><br><input id="q" value="init"></div>
<button id="go" type="button">Go</button>
<script nonce="n">${script}</script>
</body></html>`;


test("the five escaped characters and numeric references decode like a browser", () => {
  assert.equal(decodeEntities("&lt;b&gt; &amp; &quot;q&quot; &#39;s&#39; &#x41;&apos;"), "<b> & \"q\" 's' A'");
  assert.equal(decodeEntities("&unknown; &amp"), "&unknown; &amp");
});

test("parsing and serializing round-trip markup, escaping text and attribute values", () => {
  const page = runPage(PAGE());
  const box = page.document.createElement("div");
  parseHtml('<a href="x?a=1&amp;b=&quot;2&quot;">t &lt; u</a><br><input disabled value=\'v\'>', box, page.document);
  assert.equal(box.children[0].getAttribute("href"), 'x?a=1&b="2"');
  assert.equal(box.children[0].textContent, "t < u");
  assert.equal(serializeNode(box.children[0]), '<a href="x?a=1&amp;b=&quot;2&quot;">t &lt; u</a>');
  assert.equal(box.innerHTML, '<a href="x?a=1&amp;b=&quot;2&quot;">t &lt; u</a><br><input disabled="" value="v">');
});

test("comments and doctypes are dropped, stray end tags ignored, and unclosed tags tolerated", () => {
  const page = runPage(PAGE());
  const box = page.document.createElement("div");
  parseHtml("<!DOCTYPE html><!-- note --></b><p>one<p>two</div>", box, page.document);
  assert.equal(box.innerHTML, "<p>one<p>two</p></p>");
});

test("script and style contents stay raw text", () => {
  const page = runPage(PAGE());
  const box = page.document.createElement("div");
  parseHtml("<script>if (a < b && c) { x = '&amp;'; }</script><style>p > b { color: red }</style>", box, page.document);
  assert.deepEqual(box.children.map((c) => c.textContent), ["if (a < b && c) { x = '&amp;'; }", "p > b { color: red }"]);
});

test("the page markup becomes elements, with entities decoded and void tags closed", () => {
  const page = runPage(PAGE());
  assert.equal(page.document.documentElement.getAttribute("lang"), "en");
  assert.equal(page.document.body.className, "dark");
  assert.equal(page.byId("root").children.map((c) => c.tag).join(","), "p,p,br,input");
  assert.equal(page.all("p")[0].textContent, "one & two");
  assert.equal(page.byId("q").value, "init");
});

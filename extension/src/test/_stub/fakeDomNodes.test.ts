// Tests for the fake DOM's elements and tree editing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runPage } from "./fakeDom";

const PAGE = (script = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><title>t</title><style>.x { color: red; }</style></head>
<body class="dark">
<div id="root" class="a b"><p class="x" data-n="1">one &amp; two</p><p class="x y" data-n="2">three</p><br><input id="q" value="init"></div>
<button id="go" type="button">Go</button>
<script nonce="n">${script}</script>
</body></html>`;


test("appending a node moves it out of its old parent, and removing detaches it", () => {
  const page = runPage(PAGE());
  const p = page.one("p");
  const button = page.byId("go");
  button.appendChild(p);
  assert.equal(p.parentNode, button);
  assert.equal(page.byId("root").children.length, 3);
  p.remove();
  assert.equal(p.parentNode, null);
  assert.equal(button.children.length, 0);
});

test("textContent concatenates descendants and replaces children when set", () => {
  const page = runPage(PAGE());
  assert.equal(page.byId("root").textContent, "one & twothree");
  page.byId("root").textContent = "";
  assert.equal(page.byId("root").childNodes.length, 0);
});

test("closest, matches and contains follow the tree", () => {
  const page = runPage(PAGE());
  const p = page.one('[data-n="2"]');
  assert.equal(p.closest("#root"), page.byId("root"));
  assert.equal(p.closest("p"), p);
  assert.equal(p.closest("button"), null);
  assert.equal(p.matches("p.x"), true);
  assert.equal(page.byId("root").contains(p), true);
  assert.equal(p.contains(page.byId("root")), false);
});

test("classList toggles with and without force; dataset maps to data attributes", () => {
  const page = runPage(PAGE());
  const el = page.byId("go");
  el.classList.add("one", "two");
  assert.equal(el.classList.toggle("two"), false);
  assert.equal(el.classList.toggle("three", true), true);
  assert.equal(el.classList.toggle("three", true), true);
  assert.equal(el.className, "one three");
  el.dataset.groupId = "g1";
  assert.equal(el.getAttribute("data-group-id"), "g1");
  assert.equal(el.dataset.groupId, "g1");
  el.dataset.count = undefined as unknown as string;
  assert.equal(el.dataset.count, "undefined");
  assert.deepEqual(Object.keys(el.dataset), ["groupId", "count"]);
});

test("innerHTML parses markup, textContent does not, and escaping round-trips", () => {
  const page = runPage(PAGE());
  const box = page.byId("root");
  box.innerHTML = '<b id="made">x</b><i></i>';
  assert.equal(box.children.length, 2);
  assert.equal(page.byId("made").textContent, "x");
  box.textContent = '<b id="evil">';
  assert.equal(box.children.length, 0);
  assert.equal(box.innerHTML, "&lt;b id=\"evil\"&gt;");
  box.innerHTML = "&lt;b&gt; &amp; &#39;q&#39;";
  assert.equal(box.children.length, 0);
  assert.equal(box.textContent, "<b> & 'q'");
});

test("a disabled button ignores click()", () => {
  const page = runPage(PAGE());
  let n = 0;
  const btn = page.byId("go");
  btn.addEventListener("click", () => n++);
  btn.disabled = true;
  btn.click();
  btn.disabled = false;
  btn.click();
  assert.equal(n, 1);
});

test("select value follows the selected option, and typing fires input", () => {
  const page = runPage(PAGE());
  const sel = page.document.createElement("select");
  for (const v of ["a", "b"]) {
    const o = page.document.createElement("option");
    o.value = v;
    sel.appendChild(o);
  }
  assert.equal(sel.value, "a");
  sel.value = "b";
  assert.equal(sel.value, "b");
  const input = page.byId("q");
  let seen = "";
  input.addEventListener("input", () => { seen = input.value; });
  page.type(input, "typed");
  assert.equal(seen, "typed");
});

test("style supports free properties, custom properties and cssText", () => {
  const page = runPage(PAGE());
  const el = page.byId("go");
  const free = el.style as unknown as Record<string, string>;
  free.left = "3px";
  el.style.setProperty("--tint", "red");
  el.style.cssText = "font-size: .85em; z-index: 300";
  assert.equal(el.style.getPropertyValue("--tint"), "red");
  assert.equal(free.left, "3px");
  assert.equal(free.zIndex, "300");
  assert.equal(free.fontSize, ".85em");
});

test("focus moves document.activeElement", () => {
  const page = runPage(PAGE());
  assert.equal(page.document.activeElement, page.document.body);
  page.byId("go").focus();
  assert.equal(page.document.activeElement, page.byId("go"));
});

// Tests for the fake DOM harness the webview script tests run on.

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

test("the page markup becomes elements, with entities decoded and void tags closed", () => {
  const page = runPage(PAGE());
  assert.equal(page.document.documentElement.getAttribute("lang"), "en");
  assert.equal(page.document.body.className, "dark");
  assert.equal(page.byId("root").children.map((c) => c.tag).join(","), "p,p,br,input");
  assert.equal(page.all("p")[0].textContent, "one & two");
  assert.equal(page.byId("q").value, "init");
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

test("events bubble from the target to the document and the window, and stopPropagation ends the walk", () => {
  const page = runPage(PAGE());
  const seen: string[] = [];
  page.byId("root").addEventListener("click", () => seen.push("root"));
  page.document.addEventListener("click", () => seen.push("document"));
  page.window.addEventListener("click", () => seen.push("window"));
  (page.byId("go") as unknown as { onclick: () => void }).onclick = () => seen.push("go-on");
  page.byId("go").addEventListener("click", () => seen.push("go"));
  page.click(page.one("p"));
  assert.deepEqual(seen, ["root", "document", "window"]);
  seen.length = 0;
  page.byId("go").addEventListener("click", (e) => e.stopPropagation());
  page.click(page.byId("go"));
  assert.deepEqual(seen, ["go", "go-on"]);
});

test("non-bubbling events stop at the target and removed listeners no longer fire", () => {
  const page = runPage(PAGE());
  const seen: string[] = [];
  const onEnter = (): void => { seen.push("enter"); };
  page.byId("go").addEventListener("mouseenter", onEnter);
  page.document.addEventListener("mouseenter", () => seen.push("document"));
  page.fire(page.byId("go"), "mouseenter");
  page.byId("go").removeEventListener("mouseenter", onEnter);
  page.fire(page.byId("go"), "mouseenter");
  assert.deepEqual(seen, ["enter"]);
  assert.equal(page.byId("go").listenerCount("mouseenter"), 0);
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

test("the script can post to the host, and posted messages are plain copies", () => {
  const page = runPage(PAGE("const v = acquireVsCodeApi(); v.postMessage({ type: 'ready', list: [1] });"));
  const [msg] = page.takePosted();
  assert.deepEqual(msg, { type: "ready", list: [1] });
  assert.deepEqual(page.posted, []);
});

test("acquireVsCodeApi can be called only once, like the real webview", () => {
  assert.throws(() => runPage(PAGE("acquireVsCodeApi(); acquireVsCodeApi();")), /already been acquired/);
});

test("getState returns the saved state and setState records every save", () => {
  const page = runPage(PAGE("const v = acquireVsCodeApi(); const s = v.getState(); v.setState({ n: s.n + 1 });"), { state: { n: 4 } });
  assert.deepEqual(page.states, [{ n: 5 }]);
  assert.deepEqual(page.state, { n: 5 });
});

test("receive delivers a copy of the data to window message listeners", () => {
  const page = runPage(PAGE("window.addEventListener('message', (e) => { acquireVsCodeApi().postMessage(e.data.type); });"));
  page.receive({ type: "hello" });
  assert.deepEqual(page.posted, ["hello"]);
});

test("timers and frames run only when the test advances them", () => {
  const page = runPage(PAGE("var order = []; setTimeout(() => order.push('b'), 200); setTimeout(() => order.push('a'), 100); requestAnimationFrame(() => order.push('f')); var t = setTimeout(() => order.push('never'), 50); clearTimeout(t);"));
  assert.deepEqual(page.evalJson("order"), []);
  page.frames.flush();
  assert.deepEqual(page.evalJson("order"), ["f"]);
  page.timers.advance(150);
  assert.deepEqual(page.evalJson("order"), ["f", "a"]);
  assert.equal(page.timers.pending, 1);
  page.timers.runAll();
  assert.deepEqual(page.evalJson("order"), ["f", "a", "b"]);
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

test("canvas contexts record calls and assignments; rects and hit tests are test-controlled", () => {
  const page = runPage(PAGE());
  const canvas = page.document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const drawing = ctx as unknown as { moveTo(x: number, y: number): void; strokeStyle: string };
  drawing.moveTo(1, 2);
  drawing.strokeStyle = "red";
  assert.deepEqual(ctx.calls, [{ op: "moveTo", args: [1, 2] }]);
  assert.deepEqual(ctx.assigned, [{ prop: "strokeStyle", value: "red" }]);
  const go = page.byId("go");
  go.rect = { left: 1, top: 2, right: 11, bottom: 22, width: 10, height: 20 };
  assert.equal(go.getBoundingClientRect().bottom, 22);
  page.document.hitTest = () => go;
  assert.equal(page.document.elementFromPoint(0, 0), go);
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

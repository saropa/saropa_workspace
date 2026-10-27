// Tests for the page harness: running a page's scripts, the host API, timers and canvas.

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

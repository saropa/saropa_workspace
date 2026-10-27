// Tests for the fake DOM's events, listener registry and drag data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDataTransfer, FakeEvent, FakeEventTarget } from "./fakeDomEvents";
import { runPage } from "./fakeDom";

const PAGE = (script = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><title>t</title><style>.x { color: red; }</style></head>
<body class="dark">
<div id="root" class="a b"><p class="x" data-n="1">one &amp; two</p><p class="x y" data-n="2">three</p><br><input id="q" value="init"></div>
<button id="go" type="button">Go</button>
<script nonce="n">${script}</script>
</body></html>`;


test("events bubble by default, except the ones a browser does not bubble", () => {
  assert.deepEqual(["click", "keydown", "input", "mouseenter", "mouseleave", "focus", "blur", "scroll"].map((t) => new FakeEvent(t).bubbles), [true, true, true, false, false, false, false, false]);
  assert.equal(new FakeEvent("click", { bubbles: false }).bubbles, false);
});

test("a target runs its listeners in order, then its on-property handler, and a removed listener stays quiet", () => {
  const target = new FakeEventTarget() as FakeEventTarget & { onping?: () => void };
  const seen: string[] = [];
  const first = (): void => { seen.push("first"); };
  target.addEventListener("ping", first);
  target.addEventListener("ping", () => seen.push("second"));
  target.onping = () => seen.push("property");
  target.invoke(new FakeEvent("ping"));
  target.removeEventListener("ping", first);
  target.invoke(new FakeEvent("ping"));
  assert.deepEqual(seen, ["first", "second", "property", "second", "property"]);
  assert.equal(target.listenerCount("ping"), 1);
});

test("a listener added or removed during dispatch does not change the current round", () => {
  const target = new FakeEventTarget();
  const seen: string[] = [];
  target.addEventListener("x", () => { seen.push("a"); target.addEventListener("x", () => seen.push("late")); });
  target.invoke(new FakeEvent("x"));
  assert.deepEqual(seen, ["a"]);
});

test("a data transfer stores text by type and returns an empty string for a type never set", () => {
  const dt = new FakeDataTransfer();
  dt.setData("text/plain", "hello");
  assert.deepEqual([dt.getData("text/plain"), dt.getData("text/event"), dt.effectAllowed, dt.dropEffect], ["hello", "", "uninitialized", "none"]);
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

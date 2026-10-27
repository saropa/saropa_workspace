// Tests for the fake webview panel the panel tests drive.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __lastWebviewPanel, __resetWebviewPanels, createdPanels, fakeWebviewPanel } from "./vscodeWebview";

beforeEach(() => __resetWebviewPanels());

test("a new panel starts visible and empty, with its type and title", () => {
  const panel = fakeWebviewPanel("saropa.test", "Title");
  assert.deepEqual(
    [panel.viewType, panel.title, panel.visible, panel.webview.html, panel.webview.postedMessages, panel.disposed],
    ["saropa.test", "Title", true, "", [], false]
  );
});

test("posted messages are recorded in order and report success", async () => {
  const { webview } = fakeWebviewPanel("t", "t");
  assert.equal(await webview.postMessage({ a: 1 }), true);
  await webview.postMessage("two");
  assert.deepEqual(webview.postedMessages, [{ a: 1 }, "two"]);
});

test("a message from the client reaches the registered handler", () => {
  const { webview } = fakeWebviewPanel("t", "t");
  const seen: unknown[] = [];
  webview.onDidReceiveMessage((m) => seen.push(m));
  webview.__receiveFromClient({ type: "ready" });
  assert.deepEqual(seen, [{ type: "ready" }]);
});

test("a message with no handler registered is dropped without error", () => {
  fakeWebviewPanel("t", "t").webview.__receiveFromClient("lost");
});

test("dispose fires the dispose listener once and marks the panel disposed", () => {
  const panel = fakeWebviewPanel("t", "t");
  let fired = 0;
  panel.onDidDispose(() => void fired++);
  panel.dispose();
  panel.dispose();
  assert.equal(fired, 1);
  assert.equal(panel.disposed, true);
});

test("the last created panel can be read back, and a reset disposes and forgets them all", () => {
  const first = fakeWebviewPanel("a", "a");
  const second = fakeWebviewPanel("b", "b");
  createdPanels.push(first, second);
  assert.equal(__lastWebviewPanel(), second);
  __resetWebviewPanels();
  assert.equal(__lastWebviewPanel(), undefined);
  assert.deepEqual([first.disposed, second.disposed], [true, true]);
});

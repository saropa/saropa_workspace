// Tests for the Set Params webview's message protocol (setParamsPanel.ts), using
// the fake webview panel (createWebviewPanel / FakeWebview) added to the vscode
// stub for this purpose. Exercises the host side only — the client script's DOM
// rendering is not run under Node, so these assert on what the host POSTS to the
// client and what it WRITES to promptMemory in response to a simulated client
// message, not on any rendered markup. A real Extension Development Host smoke
// test still covers the client-side rendering these tests cannot reach.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __lastWebviewPanel,
  __resetWebviewPanels,
  __setOpenDialogHandler,
  __setWorkspaceFolders,
  __resetHandlers,
  FakeWebviewPanel,
  Uri,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { promptMemory } from "../exec/promptMemory";
import { SetParamsPanel } from "../views/setParamsPanel";
import { Shortcut } from "../model/shortcut";

// A macrotask boundary: Node fully drains the microtask queue (however many
// `await`s deep) before a timer fires, so this reliably waits out the
// fire-and-forget `void this.onMessage(...)` chain the panel uses for its
// onDidReceiveMessage handler (the same pattern ConfigureRunPanel uses).
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function shortcutWith(id: string, exec: Shortcut["exec"]): Shortcut {
  return { id, path: "x", scope: "project", order: 0, exec };
}

function lastFields(panel: FakeWebviewPanel): any[] {
  const initMsgs = panel.webview.postedMessages.filter(
    (m: any) => m.type === "init"
  ) as Array<{ type: string; fields: any[] }>;
  return initMsgs[initMsgs.length - 1].fields;
}

beforeEach(() => {
  __resetWebviewPanels();
  __resetHandlers();
  __setWorkspaceFolders(undefined);
  promptMemory.init(fakeContext());
});

// SetParamsPanel keeps its open panel in a module-level singleton (so a second
// "Set Params" invocation repoints the existing tab rather than opening a new
// one — see repoint()). Without disposing it here, a test that never triggers
// save/cancel would leak that singleton into the NEXT test, which would then
// silently repoint the stale panel instead of creating (and tracking) a fresh
// one via createWebviewPanel.
afterEach(() => {
  __lastWebviewPanel()?.dispose();
});

test("show() posts init with one field per token, seeded from promptMemory", async () => {
  const shortcut = shortcutWith("p1", {
    command: "deploy ${prompt:Target}",
    args: ["${pick:dev,prod}"],
  });
  await promptMemory.remember("p1", new Map([["${prompt:Target}", "server1"]]));

  SetParamsPanel.show(shortcut);
  const panel = __lastWebviewPanel();
  assert.ok(panel);
  panel!.webview.__receiveFromClient({ type: "ready" });
  await flush();

  const fields = lastFields(panel!);
  assert.equal(fields.length, 2);
  const target = fields.find((f) => f.raw === "${prompt:Target}");
  assert.equal(target.value, "server1");
  assert.equal(target.answered, true);
  const pick = fields.find((f) => f.raw === "${pick:dev,prod}");
  assert.equal(pick.answered, false);
  assert.deepEqual(pick.options, ["dev", "prod"]);
});

test("a remembered pick value no longer in the declared option list stays selectable", async () => {
  const shortcut = shortcutWith("p1", { args: ["${pick:dev,prod}"] });
  await promptMemory.remember("p1", new Map([["${pick:dev,prod}", "staging"]]));

  SetParamsPanel.show(shortcut);
  const panel = __lastWebviewPanel();
  panel!.webview.__receiveFromClient({ type: "ready" });
  await flush();

  const [field] = lastFields(panel!);
  assert.equal(field.value, "staging");
  assert.deepEqual(field.options, ["staging", "dev", "prod"]);
});

test("save writes every submitted value to promptMemory and disposes the panel", async () => {
  const shortcut = shortcutWith("p1", { args: ["${prompt:Target}"] });
  SetParamsPanel.show(shortcut);
  const panel = __lastWebviewPanel();

  panel!.webview.__receiveFromClient({
    type: "save",
    values: { "${prompt:Target}": "server2" },
  });
  await flush();

  assert.equal(promptMemory.getValue("p1", "${prompt:Target}"), "server2");
  assert.equal(panel!.disposed, true);
});

test("reset clears one token's memory and re-posts init reflecting the change, without disposing", async () => {
  const shortcut = shortcutWith("p1", {
    args: ["${prompt:Target}", "${pick:dev,prod}"],
  });
  await promptMemory.remember(
    "p1",
    new Map([
      ["${prompt:Target}", "server1"],
      ["${pick:dev,prod}", "prod"],
    ])
  );

  SetParamsPanel.show(shortcut);
  const panel = __lastWebviewPanel();
  panel!.webview.__receiveFromClient({ type: "ready" });
  await flush();

  panel!.webview.__receiveFromClient({ type: "reset", raw: "${prompt:Target}" });
  await flush();

  assert.equal(promptMemory.getValue("p1", "${prompt:Target}"), undefined);
  // The other token's memory is untouched.
  assert.equal(promptMemory.getValue("p1", "${pick:dev,prod}"), "prod");
  assert.equal(panel!.disposed, false);

  const fields = lastFields(panel!);
  const target = fields.find((f: any) => f.raw === "${prompt:Target}");
  assert.equal(target.value, "");
  assert.equal(target.answered, false);
});

test("browse posts the picked folder back for the requesting field only", async () => {
  const shortcut = shortcutWith("p1", { args: ["${pickFolder:Log folder}"] });
  __setOpenDialogHandler(async () => [Uri.file("/work/logs")]);

  SetParamsPanel.show(shortcut);
  const panel = __lastWebviewPanel();
  panel!.webview.__receiveFromClient({ type: "browse", raw: "${pickFolder:Log folder}" });
  await flush();

  const browsed = panel!.webview.postedMessages.find((m: any) => m.type === "browsed") as any;
  assert.ok(browsed);
  assert.equal(browsed.raw, "${pickFolder:Log folder}");
  assert.equal(browsed.value, "/work/logs");
});

test("cancel disposes the panel without touching promptMemory", async () => {
  const shortcut = shortcutWith("p1", { args: ["${prompt:Target}"] });
  await promptMemory.remember("p1", new Map([["${prompt:Target}", "server1"]]));

  SetParamsPanel.show(shortcut);
  const panel = __lastWebviewPanel();
  panel!.webview.__receiveFromClient({ type: "cancel" });
  await flush();

  assert.equal(panel!.disposed, true);
  assert.equal(promptMemory.getValue("p1", "${prompt:Target}"), "server1");
});

test("show() on a shortcut with no interactive tokens opens no panel", () => {
  const shortcut = shortcutWith("p1", { command: "echo hi" });
  SetParamsPanel.show(shortcut);
  assert.equal(__lastWebviewPanel(), undefined);
});

test("show() on a second shortcut while the panel is open repoints it instead of opening a new one", async () => {
  const first = shortcutWith("p1", { args: ["${prompt:Target}"] });
  const second = shortcutWith("p2", { args: ["${pick:a,b}"] });

  SetParamsPanel.show(first);
  const panel = __lastWebviewPanel();

  SetParamsPanel.show(second);
  assert.equal(__lastWebviewPanel(), panel, "no second panel was created");

  panel!.webview.__receiveFromClient({ type: "ready" });
  await flush();
  const [field] = lastFields(panel!);
  assert.equal(field.raw, "${pick:a,b}", "the repointed panel now serves the second shortcut");
});

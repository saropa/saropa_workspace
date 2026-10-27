// Tests for the Planner panel host: the single panel, the data it pushes (stored shortcuts,
// links, saved positions, the minute of day) on ready, refresh and every change, and the
// routing of each message to its handler. The handlers themselves are covered in
// plannerPanelMessages.test.ts; here each route is checked by its visible effect.
// The clock is fixed to local 2026-03-04 10:07.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __infoMessages, __resetInfo, __recordedCommands, __resetRecordedCommands,
  __lastWebviewPanel, __resetWebviewPanels, type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { settle, flushEvents } from "./settle";
import { ShortcutStore } from "../model/shortcutStore";
import { PlannerPanel } from "../views/plannerPanel";
import { LAYOUT_KEY } from "../views/plannerPanelMessages";
import { runStatusRegistry } from "../exec/runStatus";
import type { Shortcut } from "../model/shortcut";

interface DataMessage {
  type: string;
  data: { nodes: Array<{ id: string; kind: string; label: string }>; edges: Array<{ from: string; to: string; kind: string }> };
  positions: Record<string, { x: number; y: number }>;
  nowMin: number;
}

let dir: string;
let store: ShortcutStore;
let ctx: ReturnType<typeof fakeContext>;

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
const datas = (): DataMessage[] => (panel().webview.postedMessages as DataMessage[]).filter((m) => m.type === "data");
const fresh = (sc: Shortcut): Shortcut => store.findShortcut(sc.id)!;
const commands = (): string[] => __recordedCommands().map((c) => c.command);

async function stored(name: string, label?: string): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  const sc = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
  if (label) {
    await store.renameShortcut(sc, label);
  }
  return store.findShortcut(sc.id)!;
}
const ready = async (): Promise<void> => {
  const before = datas().length;
  send({ type: "ready" });
  await settle(() => datas().length === before + 1);
};

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-planner-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetInfo(); __resetRecordedCommands(); __resetWebviewPanels();
  ctx = fakeContext();
  store = new ShortcutStore(ctx);
  await store.init();
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 2, 4, 10, 7, 0) });
});

afterEach(() => {
  mock.timers.reset();
  __resetWebviewPanels();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("show opens one scripted panel with the planner title and the shell page", () => {
  PlannerPanel.show(ctx, store);
  assert.equal(panel().viewType, "saropaWorkspace.planner");
  assert.equal(panel().title, "Saropa Schedule & Workflow Planner");
  const html = panel().webview.html;
  const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1] ?? "";
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.ok(html.includes(`script-src 'nonce-${nonce}'`));
  assert.match(html, /id="stage"/);
});

test("showing again reuses the panel and pushes fresh data at once", async () => {
  PlannerPanel.show(ctx, store);
  const first = panel();
  PlannerPanel.show(ctx, store);
  assert.equal(panel(), first);
  await settle(() => datas().length === 1);
});

test("closing the panel lets the next show create a new one", () => {
  PlannerPanel.show(ctx, store);
  const first = panel();
  first.dispose();
  PlannerPanel.show(ctx, store);
  assert.notEqual(panel(), first);
});

test("nothing is pushed until the page is ready", async () => {
  PlannerPanel.show(ctx, store);
  await flushEvents();
  assert.deepEqual(datas(), []);
});

test("ready pushes the stored shortcuts, no saved positions and the minute of the day", async () => {
  const sc = await stored("a.sh", "Alpha");
  PlannerPanel.show(ctx, store);
  await ready();
  const msg = datas()[0];
  assert.deepEqual(msg.data.nodes.map((n) => [n.id, n.kind, n.label]), [[sc.id, "pin", "Alpha"]]);
  assert.deepEqual(msg.data.edges, []);
  assert.deepEqual(msg.positions, {});
  assert.equal(msg.nowMin, 10 * 60 + 7);
});

test("saved positions and links are pushed with the data", async () => {
  const build = await stored("build.sh");
  const deploy = await stored("deploy.sh");
  await store.updateShortcutTriggers(deploy, [{ kind: "pin", pinId: build.id }, { kind: "event", event: "gitPush" }], undefined);
  await ctx.workspaceState.update(LAYOUT_KEY, { [build.id]: { x: 5, y: 6 } });
  PlannerPanel.show(ctx, store);
  await ready();
  const msg = datas()[0];
  assert.deepEqual(msg.data.edges, [
    { from: build.id, to: deploy.id, kind: "pin" },
    { from: "event:gitPush", to: deploy.id, kind: "event" },
  ]);
  assert.deepEqual(msg.positions, { [build.id]: { x: 5, y: 6 } });
});

test("refresh pushes the data again", async () => {
  PlannerPanel.show(ctx, store);
  await ready();
  send({ type: "refresh" });
  await settle(() => datas().length === 2);
});

test("a change in the stored shortcuts and a recorded run each push without being asked", async () => {
  PlannerPanel.show(ctx, store);
  await ready();
  const sc = await stored("a.sh");
  await settle(() => datas().length >= 2 && datas().at(-1)!.data.nodes.length === 1);
  const before = datas().length;
  runStatusRegistry.record(sc.id, { outcome: "success", exitCode: 0, durationMs: 1, endedAt: 1 });
  try {
    await settle(() => datas().length > before);
  } finally {
    runStatusRegistry.clear(sc.id);
  }
});

test("after the panel closes, later changes push nothing", async () => {
  PlannerPanel.show(ctx, store);
  const closed = panel();
  await ready();
  closed.dispose();
  const count = closed.webview.postedMessages.length;
  await stored("a.sh");
  await flushEvents();
  assert.equal(closed.webview.postedMessages.length, count);
});

test("run and open go to the tree's commands with the stored shortcut", async () => {
  const sc = await stored("a.sh");
  PlannerPanel.show(ctx, store);
  send({ type: "run", id: sc.id });
  send({ type: "open", id: sc.id });
  await settle(() => __recordedCommands().length === 2);
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as Shortcut).id]), [
    ["saropaWorkspace.runPin", sc.id], ["saropaWorkspace.openPin", sc.id],
  ]);
});

test("configure schedule and configure triggers run their command and then push", async () => {
  const sc = await stored("a.sh");
  PlannerPanel.show(ctx, store);
  send({ type: "configureSchedule", id: sc.id });
  await settle(() => datas().length === 1);
  send({ type: "configureTriggers", id: sc.id });
  await settle(() => datas().length === 2);
  assert.deepEqual(commands(), ["saropaWorkspace.configureSchedule", "saropaWorkspace.configureTriggers"]);
});

test("toggleEnabled pauses a schedule and tells the user", async () => {
  const sc = await stored("a.sh", "Alpha");
  await store.updateShortcutSchedule(sc, { atTime: "09:00", enabled: true });
  PlannerPanel.show(ctx, store);
  send({ type: "toggleEnabled", id: sc.id });
  await settle(() => fresh(sc).schedule?.enabled === false);
  assert.deepEqual(__infoMessages(), ["Paused Alpha. It will not run on its own until resumed."]);
});

test("retime moves the time and the weekday", async () => {
  const sc = await stored("a.sh");
  await store.updateShortcutSchedule(sc, { atTime: "09:00", days: [1, 3], enabled: true });
  PlannerPanel.show(ctx, store);
  send({ type: "retime", id: sc.id, atTime: "11:15", fromDay: 3, toDay: 5 });
  await settle(() => fresh(sc).schedule?.atTime === "11:15");
  assert.deepEqual(fresh(sc).schedule?.days, [1, 5]);
});

test("addTrigger and removeTrigger edit the links of the target", async () => {
  const build = await stored("build.sh");
  const deploy = await stored("deploy.sh");
  PlannerPanel.show(ctx, store);
  send({ type: "addTrigger", to: deploy.id, kind: "pin", from: build.id });
  await settle(() => fresh(deploy).triggers?.length === 1);
  send({ type: "addTrigger", to: deploy.id, kind: "event", event: "build" });
  await settle(() => fresh(deploy).triggers?.length === 2);
  send({ type: "removeTrigger", to: deploy.id, from: build.id });
  await settle(() => fresh(deploy).triggers?.length === 1);
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "event", event: "build" }]);
});

test("savePositions keeps the layout in workspace state", async () => {
  PlannerPanel.show(ctx, store);
  send({ type: "savePositions", positions: { n1: { x: 1, y: 2 } } });
  await settle(() => ctx.workspaceState.get(LAYOUT_KEY) !== undefined);
  assert.deepEqual(ctx.workspaceState.get(LAYOUT_KEY), { n1: { x: 1, y: 2 } });
});

test("messages that are not objects, or have an unknown type, change and push nothing", async () => {
  const sc = await stored("a.sh");
  PlannerPanel.show(ctx, store);
  await flushEvents();
  const pushed = datas().length;
  for (const m of [null, undefined, "run", 3, {}, { type: "nope", id: sc.id }]) {
    send(m);
  }
  await flushEvents();
  assert.equal(datas().length, pushed);
  assert.deepEqual(__recordedCommands(), []);
  assert.equal(panel().disposed, false);
});

test("messages naming a stale shortcut do nothing", async () => {
  PlannerPanel.show(ctx, store);
  for (const type of ["run", "open", "toggleEnabled", "retime"]) {
    send({ type, id: "gone", atTime: "10:00" });
  }
  send({ type: "addTrigger", to: "gone", kind: "event", event: "build" });
  send({ type: "removeTrigger", to: "gone", from: "x" });
  await flushEvents();
  assert.deepEqual(__recordedCommands(), []);
  assert.deepEqual(__infoMessages(), []);
});

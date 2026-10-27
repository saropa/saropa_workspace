// Tests for the Planner's message handlers: run and open, toggling a schedule, retiming by
// drag, adding and removing chain links, and saving graph positions. The webview payload is
// untrusted, so each handler is also driven with stale ids and values that make no sense.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __infoMessages, __resetInfo, __recordedCommands, __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import {
  LAYOUT_KEY, findStored, runById, openById, runCommandForShortcut, toggleEnabled, retime, addTrigger, removeTrigger, savePositions,
} from "../views/plannerPanelMessages";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;

async function stored(name: string, label?: string): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  const sc = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
  if (label) {
    await store.renameShortcut(sc, label);
  }
  return store.findShortcut(sc.id)!;
}
const fresh = (sc: Shortcut): Shortcut => store.findShortcut(sc.id)!;

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-plmsg-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetInfo();
  __resetRecordedCommands();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("findStored resolves a stored id and gives nothing for a missing, empty or unknown id", async () => {
  const sc = await stored("a.sh");
  assert.equal(findStored(store, sc.id)?.id, sc.id);
  assert.equal(findStored(store, undefined), undefined);
  assert.equal(findStored(store, ""), undefined);
  assert.equal(findStored(store, "unknown"), undefined);
});

test("run and open hand the stored shortcut to the same commands the tree uses", async () => {
  const sc = await stored("a.sh");
  await runById(store, sc.id);
  await openById(store, sc.id);
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as Shortcut).id]), [
    ["saropaWorkspace.runPin", sc.id],
    ["saropaWorkspace.openPin", sc.id],
  ]);
});

test("run and open for a stale or missing id do nothing", async () => {
  await runById(store, "gone");
  await openById(store, "gone");
  await runById(store);
  await openById(store);
  assert.deepEqual(__recordedCommands(), []);
});

test("a context-menu command runs against the shortcut and then forces one repaint", async () => {
  const sc = await stored("a.sh");
  let pushes = 0;
  await runCommandForShortcut(store, "saropaWorkspace.configureSchedule", sc.id, async () => { pushes++; });
  assert.deepEqual(__recordedCommands().map((c) => c.command), ["saropaWorkspace.configureSchedule"]);
  assert.equal(pushes, 1);
});

test("a context-menu command for a stale id neither runs nor repaints", async () => {
  let pushes = 0;
  await runCommandForShortcut(store, "saropaWorkspace.configureSchedule", "gone", async () => { pushes++; });
  await runCommandForShortcut(store, "saropaWorkspace.configureSchedule", undefined, async () => { pushes++; });
  assert.deepEqual(__recordedCommands(), []);
  assert.equal(pushes, 0);
});

test("pausing a schedule keeps its timing and says which shortcut was paused", async () => {
  const sc = await stored("a.sh", "Nightly");
  await store.updateShortcutSchedule(sc, { atTime: "09:00", days: [1], enabled: true });
  await toggleEnabled(store, sc.id);
  assert.deepEqual(fresh(sc).schedule, { atTime: "09:00", days: [1], enabled: false });
  assert.deepEqual(__infoMessages(), ["Paused Nightly. It will not run on its own until resumed."]);
});

test("resuming a paused schedule turns it back on", async () => {
  const sc = await stored("a.sh", "Nightly");
  await store.updateShortcutSchedule(sc, { atTime: "09:00", enabled: false });
  await toggleEnabled(store, sc.id);
  assert.equal(fresh(sc).schedule?.enabled, true);
  assert.deepEqual(__infoMessages(), ["Resumed Nightly. Its schedule will fire again."]);
});

test("the toast names an unlabeled shortcut by its file name, not its id", async () => {
  const sc = await stored("plain.sh");
  await store.updateShortcutSchedule(sc, { atTime: "09:00", enabled: true });
  await toggleEnabled(store, sc.id);
  assert.deepEqual(__infoMessages(), ["Paused plain.sh. It will not run on its own until resumed."]);
});

test("toggling a shortcut with no schedule, or a stale id, changes nothing", async () => {
  const sc = await stored("a.sh");
  await toggleEnabled(store, sc.id);
  await toggleEnabled(store, "gone");
  await toggleEnabled(store);
  assert.equal(fresh(sc).schedule, undefined);
  assert.deepEqual(__infoMessages(), []);
});

async function scheduled(days?: number[]): Promise<Shortcut> {
  const sc = await stored("t.sh");
  await store.updateShortcutSchedule(sc, { atTime: "09:00", days, enabled: true, lastRun: 5 });
  return fresh(sc);
}

test("retime changes the time and keeps the weekdays when the day did not change", async () => {
  const sc = await scheduled([1, 3]);
  await retime(store, sc.id, "14:30", 3, 3);
  await retime(store, sc.id, "15:00");
  assert.deepEqual(fresh(sc).schedule, { atTime: "15:00", days: [1, 3], enabled: true, lastRun: 5 });
});

test("retime to another weekday swaps the dragged day for the target", async () => {
  const sc = await scheduled([1, 3]);
  await retime(store, sc.id, "10:00", 3, 5);
  assert.deepEqual(fresh(sc).schedule?.days, [1, 5]);
  assert.equal(fresh(sc).schedule?.atTime, "10:00");
});

test("retime onto a weekday already in the set just removes the dragged one", async () => {
  const sc = await scheduled([1, 3]);
  await retime(store, sc.id, "10:00", 3, 1);
  assert.deepEqual(fresh(sc).schedule?.days, [1]);
});

test("retime of an every-day schedule changes only the time", async () => {
  const sc = await scheduled(undefined);
  await retime(store, sc.id, "10:00", 2, 4);
  assert.equal(fresh(sc).schedule?.atTime, "10:00");
  assert.equal(fresh(sc).schedule?.days, undefined);
});

test("retime without a time, for a shortcut with no schedule or for a stale id, changes nothing", async () => {
  const plain = await stored("p.sh");
  const sc = await scheduled([1]);
  await retime(store, sc.id, undefined, 1, 2);
  await retime(store, plain.id, "10:00");
  await retime(store, "gone", "10:00");
  assert.deepEqual(fresh(sc).schedule, { atTime: "09:00", days: [1], enabled: true, lastRun: 5 });
  assert.equal(fresh(plain).schedule, undefined);
});

test("retime refuses a time that is not a 24-hour HH:mm value", async () => {
  const sc = await scheduled([1]);
  for (const atTime of ["25:00", "9:75", "9am", "", "12", "abc", 900 as unknown as string, null as unknown as string]) {
    await retime(store, sc.id, atTime, 1, 2);
  }
  assert.deepEqual(fresh(sc).schedule, { atTime: "09:00", days: [1], enabled: true, lastRun: 5 });
});

test("retime refuses weekdays outside 0 to 6, and fractions or text", async () => {
  const sc = await scheduled([1, 3]);
  const bad: Array<[unknown, unknown]> = [[3, 9], [3, -1], [3, 1.5], [3, "5"], [9, 5], ["3", 5], [3, Number.NaN]];
  for (const [from, to] of bad) {
    await retime(store, sc.id, "10:00", from as number, to as number);
  }
  assert.deepEqual(fresh(sc).schedule?.days, [1, 3]);
});

test("a pin link is added to the target with a toast naming it", async () => {
  const build = await stored("build.sh");
  const deploy = await stored("deploy.sh", "Deploy");
  await addTrigger(store, deploy.id, "pin", build.id);
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "pin", pinId: build.id }]);
  assert.deepEqual(__infoMessages(), ["Linked Deploy. It will auto-run when the source fires."]);
});

test("the toast names an unlabeled target by its file name, not its id", async () => {
  const build = await stored("build.sh");
  const deploy = await stored("deploy.sh");
  await addTrigger(store, deploy.id, "pin", build.id);
  assert.deepEqual(__infoMessages(), ["Linked deploy.sh. It will auto-run when the source fires."]);
});

test("a second identical pin link is not added again", async () => {
  const build = await stored("build.sh");
  const deploy = await stored("deploy.sh");
  await addTrigger(store, deploy.id, "pin", build.id);
  await addTrigger(store, deploy.id, "pin", build.id);
  assert.equal(fresh(deploy).triggers?.length, 1);
  assert.equal(__infoMessages().length, 1);
});

test("a shortcut cannot be linked to itself, and a link needs a source", async () => {
  const deploy = await stored("deploy.sh");
  await addTrigger(store, deploy.id, "pin", deploy.id);
  await addTrigger(store, deploy.id, "pin");
  await addTrigger(store, deploy.id, "pin", "");
  assert.equal(fresh(deploy).triggers, undefined);
});

test("a link from a shortcut that no longer exists is refused", async () => {
  const deploy = await stored("deploy.sh");
  await addTrigger(store, deploy.id, "pin", "gone");
  assert.equal(fresh(deploy).triggers, undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("a link to a target that no longer exists is refused", async () => {
  const build = await stored("build.sh");
  await addTrigger(store, "gone", "pin", build.id);
  await addTrigger(store, undefined, "pin", build.id);
  assert.deepEqual(__infoMessages(), []);
});

test("an event link is added once and keeps the events the shortcut emits", async () => {
  const deploy = await stored("deploy.sh");
  await store.updateShortcutTriggers(deploy, undefined, ["build"]);
  await addTrigger(store, deploy.id, "event", undefined, "gitPush");
  await addTrigger(store, deploy.id, "event", undefined, "gitPush");
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "event", event: "gitPush" }]);
  assert.deepEqual(fresh(deploy).emits, ["build"]);
  assert.equal(__infoMessages().length, 1);
});

test("an event link keeps links the shortcut already has", async () => {
  const build = await stored("build.sh");
  const deploy = await stored("deploy.sh");
  await addTrigger(store, deploy.id, "pin", build.id);
  await addTrigger(store, deploy.id, "event", undefined, "publish");
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "pin", pinId: build.id }, { kind: "event", event: "publish" }]);
});

test("an event link needs a known event, and an unknown kind adds nothing", async () => {
  const deploy = await stored("deploy.sh");
  await addTrigger(store, deploy.id, "event");
  await addTrigger(store, deploy.id, "event", undefined, "rm -rf" as never);
  await addTrigger(store, deploy.id, "event", undefined, "__proto__" as never);
  await addTrigger(store, deploy.id, "idle" as never, "x");
  await addTrigger(store, deploy.id);
  assert.equal(fresh(deploy).triggers, undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("removing a link drops only the edge that came from that source", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  const deploy = await stored("deploy.sh");
  await store.updateShortcutTriggers(deploy, [
    { kind: "pin", pinId: a.id }, { kind: "pin", pinId: b.id }, { kind: "event", event: "build" }, { kind: "idle", minutes: 5 },
  ], undefined);
  await removeTrigger(store, deploy.id, a.id);
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "pin", pinId: b.id }, { kind: "event", event: "build" }, { kind: "idle", minutes: 5 }]);
  await removeTrigger(store, deploy.id, "event:build");
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "pin", pinId: b.id }, { kind: "idle", minutes: 5 }]);
});

test("an idle trigger cannot be removed through the graph", async () => {
  const deploy = await stored("deploy.sh");
  await store.updateShortcutTriggers(deploy, [{ kind: "idle", minutes: 5 }], undefined);
  await removeTrigger(store, deploy.id, "idle");
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "idle", minutes: 5 }]);
});

test("removing a link that is not there, from a stale target, or with no source changes nothing", async () => {
  const a = await stored("a.sh");
  const deploy = await stored("deploy.sh");
  await store.updateShortcutTriggers(deploy, [{ kind: "pin", pinId: a.id }], undefined);
  await removeTrigger(store, deploy.id, "other");
  await removeTrigger(store, deploy.id);
  await removeTrigger(store, "gone", a.id);
  await removeTrigger(store, a.id, deploy.id);
  assert.deepEqual(fresh(deploy).triggers, [{ kind: "pin", pinId: a.id }]);
});

test("saved positions are kept in workspace state under the layout key", async () => {
  const ctx = fakeContext();
  await savePositions(ctx, { a: { x: 10, y: 20 }, b: { x: -5.5, y: 0 } });
  assert.deepEqual(ctx.workspaceState.get(LAYOUT_KEY), { a: { x: 10, y: 20 }, b: { x: -5.5, y: 0 } });
});

test("saving no positions leaves the stored layout alone", async () => {
  const ctx = fakeContext();
  await savePositions(ctx, { a: { x: 1, y: 2 } });
  await savePositions(ctx, undefined);
  assert.deepEqual(ctx.workspaceState.get(LAYOUT_KEY), { a: { x: 1, y: 2 } });
});

test("saving positions drops entries that are not a pair of finite numbers and refuses a non-object", async () => {
  const ctx = fakeContext();
  await savePositions(ctx, {
    ok: { x: 1, y: 2 },
    text: { x: "1", y: 2 },
    missing: { x: 1 },
    nan: { x: Number.NaN, y: 0 },
    inf: { x: 0, y: Number.POSITIVE_INFINITY },
    nul: null,
    num: 7,
  } as never);
  assert.deepEqual(ctx.workspaceState.get(LAYOUT_KEY), { ok: { x: 1, y: 2 } });
  await savePositions(ctx, "oops" as never);
  await savePositions(ctx, [1, 2] as never);
  assert.deepEqual(ctx.workspaceState.get(LAYOUT_KEY), { ok: { x: 1, y: 2 } });
});

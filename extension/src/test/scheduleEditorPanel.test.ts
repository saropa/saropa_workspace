// Tests for the Schedule editor panel host: the guard for auto shortcuts, the single panel,
// the init message (stored schedule, remembered timing), the live preview (next run, cron
// validity, auto-enable), and the save round trip through the store with its toasts.
// The clock is fixed to local 2026-03-04 10:00 so next-run texts are exact.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __resetWarnings, __warningMessages, __infoMessages, __resetInfo,
  __lastWebviewPanel, __resetWebviewPanels, type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { settle, flushEvents } from "./settle";
import { ShortcutStore } from "../model/shortcutStore";
import { ScheduleEditorPanel } from "../views/scheduleEditorPanel";
import type { Shortcut } from "../model/shortcut";

const DEFAULTS_KEY = "saropaWorkspace.schedule.defaults";
const tomorrow9 = (): string => new Date(2026, 2, 5, 9, 0, 0).toLocaleString();
const today1030 = (): string => new Date(2026, 2, 4, 10, 30, 0).toLocaleString();

let dir: string;
let store: ShortcutStore;
let ctx: ReturnType<typeof fakeContext>;

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const posted = (): Array<Record<string, unknown>> => panel().webview.postedMessages as Array<Record<string, unknown>>;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
const fresh = (id: string): Shortcut => store.findShortcut(id)!;
const wire = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ enabled: true, ...over });

async function stored(name: string): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-schedpanel-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings(); __resetInfo(); __resetWebviewPanels();
  ctx = fakeContext();
  store = new ShortcutStore(ctx);
  await store.init();
  mock.timers.enable({ apis: ["Date"], now: new Date(2026, 2, 4, 10, 0, 0) });
});

afterEach(() => {
  mock.timers.reset();
  __resetWebviewPanels();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an auto shortcut cannot be scheduled: a warning, no panel", () => {
  const auto = store.getProjectShortcuts().find((p) => p.isAuto)!;
  ScheduleEditorPanel.show(ctx, store, auto);
  assert.deepEqual(__warningMessages(), ["A schedule cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
  assert.equal(__lastWebviewPanel(), undefined);
});

test("show opens one panel titled with the shortcut name", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("job.sh"));
  assert.equal(panel().viewType, "saropaWorkspace.scheduleEditor");
  assert.equal(panel().title, "Saropa Workspace Scheduler: job.sh");
  assert.match(panel().webview.html, /<html/);
});

test("showing again for another shortcut reuses the panel and saves to the new target", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  ScheduleEditorPanel.show(ctx, store, a);
  const first = panel();
  ScheduleEditorPanel.show(ctx, store, b);
  assert.equal(panel(), first);
  assert.equal(first.title, "Saropa Workspace Scheduler: b.sh");
  send({ type: "save", work: wire({ atTime: "09:00" }) });
  await settle(() => first.disposed);
  assert.equal(fresh(b.id).schedule?.atTime, "09:00");
  assert.equal(fresh(a.id).schedule, undefined);
});

test("closing the panel lets the next show create a new one", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  const first = panel();
  first.dispose();
  ScheduleEditorPanel.show(ctx, store, sc);
  assert.notEqual(panel(), first);
});

test("ready for an unscheduled shortcut posts a blank enabled form", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  assert.deepEqual(posted()[0], {
    type: "init",
    work: {
      atTime: undefined, days: undefined, everyMs: undefined, cron: undefined, runOnStartup: undefined, catchUp: undefined,
      enabled: true, lastRun: undefined, lastOutcome: undefined, lastReportPath: undefined,
    },
  });
});

test("ready for an unscheduled shortcut starts from the timing used last", async () => {
  await ctx.globalState.update(DEFAULTS_KEY, { atTime: "07:15", everyMs: 3600000 });
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  const work = (posted()[0] as { work: Record<string, unknown> }).work;
  assert.equal(work.atTime, "07:15");
  assert.equal(work.everyMs, 3600000);
  assert.equal(work.enabled, true);
});

test("ready for a scheduled shortcut posts its stored schedule and ignores the remembered timing", async () => {
  await ctx.globalState.update(DEFAULTS_KEY, { atTime: "07:15" });
  const sc = await stored("a.sh");
  await store.updateShortcutSchedule(sc, {
    atTime: "21:00", days: [1, 3], enabled: false, catchUp: true, lastRun: 123, lastOutcome: "failure", lastReportPath: "/r.md",
  });
  ScheduleEditorPanel.show(ctx, store, fresh(sc.id));
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  assert.deepEqual((posted()[0] as { work: unknown }).work, {
    atTime: "21:00", days: [1, 3], everyMs: undefined, cron: undefined, runOnStartup: undefined, catchUp: true,
    enabled: false, lastRun: 123, lastOutcome: "failure", lastReportPath: "/r.md",
  });
});

test("ready after the shortcut was removed posts nothing", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  await store.removeShortcut(sc);
  send({ type: "ready" });
  await flushEvents();
  assert.deepEqual(posted(), []);
});

const preview = async (work: Record<string, unknown>, enabledTouched?: boolean): Promise<Record<string, unknown>> => {
  const before = posted().filter((m) => m.type === "preview").length;
  send({ type: "change", work, enabledTouched });
  await settle(() => posted().filter((m) => m.type === "preview").length === before + 1);
  return posted().filter((m) => m.type === "preview")[before];
};

test("the preview of a daily time gives the next run and turns the form on", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  const msg = await preview({ enabled: false, atTime: "09:00" });
  assert.equal(msg.nextRun, tomorrow9());
  assert.equal(msg.enabled, true);
  assert.equal(msg.cronValid, true);
});

test("the next run is today when the time is still ahead", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  assert.equal((await preview({ enabled: true, atTime: "10:30" })).nextRun, today1030());
});

test("a form the user switched off stays off and says so", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  const msg = await preview({ enabled: false, atTime: "09:00" }, true);
  assert.equal(msg.nextRun, "Disabled — turn Enabled on to run it");
  assert.equal(msg.enabled, false);
});

test("a form with no timing says it is not scheduled", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  const msg = await preview({ enabled: true });
  assert.equal(msg.nextRun, "Not scheduled");
  assert.equal(msg.enabled, true);
});

test("run-on-open alone gives the when-opened text", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  assert.equal((await preview({ enabled: true, runOnStartup: true })).nextRun, "When this workspace opens");
});

test("a cron that does not parse is reported invalid, a blank or valid one is not", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  assert.equal((await preview({ enabled: true, cron: "not a cron" })).cronValid, false);
  assert.equal((await preview({ enabled: true, cron: "0 9 * * *" })).cronValid, true);
  assert.equal((await preview({ enabled: true, cron: "" })).cronValid, true);
});

test("a valid cron previews its next run", async () => {
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  assert.equal((await preview({ enabled: true, cron: "0 9 * * *" })).nextRun, tomorrow9());
});

test("the preview carries the around-your-schedule insights for the chosen time", async () => {
  const other = await stored("other.sh");
  await store.updateShortcutSchedule(other, { atTime: "09:00", enabled: true });
  ScheduleEditorPanel.show(ctx, store, await stored("a.sh"));
  const insights = (await preview({ enabled: true, atTime: "09:00" })).insights as { mine: number; neighbors: unknown[]; conflict: string };
  assert.equal(insights.mine, 540);
  assert.deepEqual(insights.neighbors, [{ n: "other.sh", m: 540 }]);
  assert.notEqual(insights.conflict, "");
});

test("a change message without a form, or a save without a form, does nothing", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  send({ type: "change" });
  send({ type: "save" });
  for (const m of [null, undefined, "save", 3, {}, { type: "nope" }]) {
    send(m);
  }
  await flushEvents();
  assert.deepEqual(posted(), []);
  assert.equal(panel().disposed, false);
  assert.equal(fresh(sc.id).schedule, undefined);
});

test("save stores the normalized schedule, tells the user the next run and closes", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  send({ type: "save", work: wire({ atTime: "09:00", days: [5, 1, 3], runOnStartup: false, catchUp: true }) });
  await settle(() => panel().disposed);
  // Unset fields are not stored at all, so a minimal object is the whole record.
  assert.deepEqual(fresh(sc.id).schedule, { atTime: "09:00", days: [1, 3, 5], catchUp: true, enabled: true });
  // 2026-03-04 is a Wednesday, so with Mon/Wed/Fri chosen and 09:00 already past, the next run is Friday.
  assert.deepEqual(__infoMessages(), [`Saved schedule for a.sh. Next run ${new Date(2026, 2, 6, 9, 0, 0).toLocaleString()}.`]);
});

test("an edit keeps the last run stamp, outcome and report of the stored schedule", async () => {
  const sc = await stored("a.sh");
  await store.updateShortcutSchedule(sc, { atTime: "08:00", enabled: true, lastRun: 555, lastOutcome: "success", lastReportPath: "/r.md" });
  ScheduleEditorPanel.show(ctx, store, fresh(sc.id));
  send({ type: "save", work: wire({ atTime: "09:00" }) });
  await settle(() => panel().disposed);
  const saved = fresh(sc.id).schedule;
  assert.deepEqual([saved?.atTime, saved?.lastRun, saved?.lastOutcome, saved?.lastReportPath], ["09:00", 555, "success", "/r.md"]);
});

test("saving timing in a switched-off form turns it on unless the user touched the switch", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  ScheduleEditorPanel.show(ctx, store, a);
  send({ type: "save", work: wire({ enabled: false, atTime: "09:00" }) });
  await settle(() => panel().disposed);
  assert.equal(fresh(a.id).schedule?.enabled, true);
  ScheduleEditorPanel.show(ctx, store, b);
  send({ type: "save", work: wire({ enabled: false, atTime: "09:00" }), enabledTouched: true });
  await settle(() => panel().disposed);
  assert.equal(fresh(b.id).schedule?.enabled, false);
  assert.equal(__infoMessages().at(-1), "Saved schedule for b.sh (disabled — turn Enabled on to run it).");
});

test("a run-on-open schedule says the next run is when the workspace opens", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  send({ type: "save", work: wire({ runOnStartup: true }) });
  await settle(() => panel().disposed);
  assert.equal(fresh(sc.id).schedule?.runOnStartup, true);
  assert.deepEqual(__infoMessages(), ["Saved schedule for a.sh. Next run When this workspace opens."]);
});

test("saving a form with no timing clears the stored schedule", async () => {
  const sc = await stored("a.sh");
  await store.updateShortcutSchedule(sc, { atTime: "08:00", enabled: true });
  ScheduleEditorPanel.show(ctx, store, fresh(sc.id));
  send({ type: "save", work: wire() });
  await settle(() => panel().disposed);
  assert.equal(fresh(sc.id).schedule, undefined);
  assert.deepEqual(__infoMessages(), ["Cleared the schedule for a.sh."]);
});

test("a save remembers the timing for the next shortcut, and clearing does not wipe it", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  ScheduleEditorPanel.show(ctx, store, a);
  send({ type: "save", work: wire({ atTime: "06:45", everyMs: 900000 }) });
  await settle(() => panel().disposed);
  assert.deepEqual(ctx.globalState.get(DEFAULTS_KEY), { atTime: "06:45", everyMs: 900000 });
  ScheduleEditorPanel.show(ctx, store, b);
  send({ type: "save", work: wire() });
  await settle(() => panel().disposed);
  assert.deepEqual(ctx.globalState.get(DEFAULTS_KEY), { atTime: "06:45", everyMs: 900000 });
});

test("saving for a shortcut removed in the meantime warns and closes without a toast about a schedule", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  await store.removeShortcut(sc);
  send({ type: "save", work: wire({ atTime: "09:00" }) });
  await settle(() => panel().disposed);
  assert.deepEqual(__warningMessages(), ["That shortcut no longer exists, so its schedule was not saved."]);
  assert.deepEqual(__infoMessages(), []);
  assert.equal(ctx.globalState.get(DEFAULTS_KEY), undefined);
});

test("cancel closes the panel and stores nothing", async () => {
  const sc = await stored("a.sh");
  ScheduleEditorPanel.show(ctx, store, sc);
  send({ type: "cancel" });
  assert.equal(panel().disposed, true);
  assert.equal(fresh(sc.id).schedule, undefined);
  assert.deepEqual(__infoMessages(), []);
});

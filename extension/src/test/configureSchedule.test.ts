// Tests for the quick schedule editor: the hub rows, each field editor, auto-enable and
// what is stored on Save.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
  __quickPicks,
  __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { configureSchedule } from "../commands/configureSchedule";
import { driveHub, drivePicks, driveInputs, type HubShowing } from "./uiDrivers";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;
let hubs: HubShowing[];

// Answers the hub in order with row ids; running out of answers presses Esc.
function hub(...ids: string[]): void {
  hubs = driveHub(...ids);
}

async function stored(name = "job.sh", schedule?: Record<string, unknown>): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  const found = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
  if (schedule) {
    await store.updateShortcutSchedule(found, schedule as never);
  }
  return store.findShortcut(found.id)!;
}

const schedOf = (s: Shortcut): Record<string, unknown> | undefined =>
  store.findShortcut(s.id)!.schedule as Record<string, unknown> | undefined;

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-sched-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  hubs = [];
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an auto shortcut cannot be scheduled", async () => {
  await configureSchedule(store, { id: "a", scope: "project", path: "x", order: 0, isAuto: true } as Shortcut);
  assert.deepEqual(__warningMessages(), ["A schedule cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
  assert.equal(__quickPicks().length, 0);
});

test("a fresh hub lists every field as unset, enabled on, and ends with Save", async () => {
  const s = await stored();
  hub();
  await configureSchedule(store, s);
  assert.equal(hubs[0].title, "Configure Schedule: job.sh");
  assert.deepEqual(hubs[0].rows.map((r) => [r.id, r.label, r.description]), [
    ["atTime", "$(clock) Daily time", "(none)"],
    ["days", "$(calendar) Days of week", "Set a daily time first"],
    ["interval", "$(sync) Repeat interval", "(none)"],
    ["cron", "$(calendar) Cron schedule", "(none)"],
    ["runOnStartup", "$(rocket) Run on workspace open", "Off"],
    ["enabled", "$(check) Enabled", "On"],
    ["save", "$(save) Save changes", "Apply and close"],
  ]);
});

test("Esc at the hub discards every edit", async () => {
  const s = await stored();
  hub("atTime");
  driveInputs("09:30");
  await configureSchedule(store, s);
  assert.equal(schedOf(s), undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("a daily time is stored on Save with the shortcut enabled", async () => {
  const s = await stored();
  hub("atTime", "save");
  driveInputs(" 09:30 ");
  await configureSchedule(store, s);
  assert.deepEqual(schedOf(s), { atTime: "09:30", enabled: true });
  assert.deepEqual(__infoMessages(), ["Saved schedule for job.sh."]);
});

test("Save with no timing stores no schedule", async () => {
  const s = await stored();
  hub("save");
  await configureSchedule(store, s);
  assert.equal(schedOf(s), undefined);
});

test("the row just edited is the active row on the next render", async () => {
  const s = await stored();
  hub("runOnStartup", "cron", "save");
  drivePicks(undefined);
  await configureSchedule(store, s);
  assert.deepEqual(hubs.map((h) => h.active), [undefined, "runOnStartup", "cron"]);
});

test("the daily time prompt rejects a bad time, allows empty, and empty clears the time", async () => {
  const s = await stored("t.sh", { atTime: "08:00", enabled: true });
  hub("atTime", "interval", "save");
  const inputs = driveInputs("");
  drivePicks("Every 5 minutes");
  await configureSchedule(store, s);
  const validate = inputs[0].validateInput!;
  assert.equal(validate("24:00"), "Enter a 24-hour time as HH:mm (00:00-23:59).");
  assert.equal(validate(""), undefined);
  assert.equal(validate(" 23:59 "), undefined);
  assert.deepEqual(schedOf(s), { everyMs: 300000, enabled: true });
});

test("canceling the time prompt keeps the existing time", async () => {
  const s = await stored("t.sh", { atTime: "08:00", enabled: true });
  hub("atTime", "save");
  driveInputs(undefined);
  await configureSchedule(store, s);
  assert.equal(schedOf(s)!.atTime, "08:00");
});

test("days need a time first and say so", async () => {
  const s = await stored();
  hub("days", "save");
  await configureSchedule(store, s);
  assert.deepEqual(__infoMessages(), ["Set a daily time first", "Saved schedule for job.sh."]);
});

test("the Weekdays and Weekends rows set their days and override the ticked days", async () => {
  const s = await stored("d.sh", { atTime: "08:00", enabled: true });
  hub("days", "save");
  const shown = drivePicks(["$(briefcase) Weekdays (Mon-Fri)", "Sat"]);
  await configureSchedule(store, s);
  assert.deepEqual(schedOf(s)!.days, [1, 2, 3, 4, 5]);
  assert.deepEqual(shown[0].rows.map((r) => r.label).slice(0, 4), ["$(briefcase) Weekdays (Mon-Fri)", "$(home) Weekends (Sat-Sun)", "Individual days", "Sun"]);

  hub("days", "save");
  drivePicks(["$(home) Weekends (Sat-Sun)"]);
  await configureSchedule(store, await stored("d2.sh", { atTime: "08:00", enabled: true }));
  const d2 = store.getProjectShortcuts().find((p) => p.path === "d2.sh")!;
  assert.deepEqual((d2.schedule as { days: number[] }).days, [0, 6]);
});

test("ticked days are stored in week order, and none or all seven both mean every day", async () => {
  const s = await stored("w.sh", { atTime: "08:00", enabled: true });
  hub("days", "save");
  drivePicks(["Wed", "Mon"]);
  await configureSchedule(store, s);
  assert.deepEqual(schedOf(s)!.days, [1, 3]);

  hub("days", "save");
  drivePicks([]);
  await configureSchedule(store, store.findShortcut(s.id)!);
  assert.equal(schedOf(s)!.days, undefined);

  hub("days", "save");
  drivePicks(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  await configureSchedule(store, store.findShortcut(s.id)!);
  assert.equal(schedOf(s)!.days, undefined);
});

test("currently chosen days start ticked in the day picker", async () => {
  const s = await stored("p.sh", { atTime: "08:00", days: [2, 4], enabled: true });
  hub("days");
  const shown = drivePicks(undefined);
  await configureSchedule(store, s);
  assert.deepEqual(shown[0].rows.filter((r) => r.picked).map((r) => r.label), ["Tue", "Thu"]);
});

test("the hub summarizes days as every day, weekdays, weekends or the names", async () => {
  const cases: Array<[number[] | undefined, string]> = [
    [undefined, "Every day"],
    [[1, 2, 3, 4, 5], "Weekdays (Mon-Fri)"],
    [[6, 0], "Weekends (Sat-Sun)"],
    [[5, 1], "Mon, Fri"],
  ];
  for (const [days, text] of cases) {
    hub();
    await configureSchedule(store, { id: "x", scope: "project", path: "x", order: 0, schedule: { atTime: "08:00", days, enabled: true } } as unknown as Shortcut);
    assert.equal(hubs[0].rows.find((r) => r.id === "days")!.description, text);
  }
});

test("interval presets store minutes as milliseconds, and the hub names them in the coarsest exact unit", async () => {
  const s = await stored();
  const shown = drivePicks("Every 6 hour(s)");
  hub("interval", "interval", "save");
  await configureSchedule(store, s);
  assert.deepEqual(shown[0].rows.map((r) => r.label), [
    "$(circle-slash) No repeat",
    "Every 5 minutes",
    "Every 15 minutes",
    "Every 30 minutes",
    "Every 1 hour(s)",
    "Every 6 hour(s)",
    "Every 12 hour(s)",
    "Every 1 day(s)",
    "$(edit) Custom...",
  ]);
  assert.equal(schedOf(s)!.everyMs, 6 * 3_600_000);
  assert.equal(hubs[1].rows.find((r) => r.id === "interval")!.description, "Every 6 hour(s)");
});

test("No repeat clears the interval", async () => {
  const s = await stored("i.sh", { everyMs: 900000, enabled: true });
  hub("interval", "atTime", "save");
  drivePicks("$(circle-slash) No repeat");
  driveInputs("10:00");
  await configureSchedule(store, s);
  assert.deepEqual(schedOf(s), { atTime: "10:00", enabled: true });
});

test("a custom interval is a unit and a whole count", async () => {
  const units: Array<[string, number]> = [["$(watch) Minutes", 60_000], ["$(clock) Hours", 3_600_000], ["$(calendar) Days", 86_400_000]];
  for (const [unit, ms] of units) {
    const s = await stored(`c-${ms}.sh`);
    hub("interval", "save");
    const shown = drivePicks("$(edit) Custom...", unit);
    const inputs = driveInputs(" 3 ");
    await configureSchedule(store, s);
    assert.equal(schedOf(s)!.everyMs, 3 * ms, unit);
    assert.deepEqual(shown[1].rows.map((r) => r.label), ["$(watch) Minutes", "$(clock) Hours", "$(calendar) Days"]);
    const validate = inputs[0].validateInput!;
    for (const bad of ["0", "-2", "1.5", "abc", ""]) {
      assert.equal(validate(bad), "Enter a whole number greater than zero.", bad);
    }
    assert.equal(validate("12"), undefined);
  }
});

test("canceling the unit or the count leaves the interval unset", async () => {
  const s = await stored();
  hub("interval", "interval", "save");
  drivePicks("$(edit) Custom...", undefined);
  await configureSchedule(store, s);
  assert.equal(schedOf(s), undefined);
  const t = await stored("c2.sh");
  hub("interval", "save");
  drivePicks("$(edit) Custom...", "$(clock) Hours");
  driveInputs(undefined);
  await configureSchedule(store, t);
  assert.equal(schedOf(t), undefined);
});

test("the cron row opens the cron builder and its result is saved", async () => {
  const s = await stored();
  hub("cron", "save");
  drivePicks("$(sync) Every hour, on the hour");
  await configureSchedule(store, s);
  assert.deepEqual(schedOf(s), { cron: "0 * * * *", enabled: true });
});

test("run on workspace open toggles on and back off", async () => {
  const s = await stored();
  hub("runOnStartup", "save");
  await configureSchedule(store, s);
  assert.deepEqual(schedOf(s), { runOnStartup: true, enabled: true });
  hub("runOnStartup", "save");
  await configureSchedule(store, store.findShortcut(s.id)!);
  assert.equal(schedOf(s), undefined);
});

test("a stored but disabled schedule with timing turns on when saved, unless Enabled was toggled by hand", async () => {
  const s = await stored("e.sh", { atTime: "07:00", enabled: false });
  hub("save");
  await configureSchedule(store, s);
  assert.equal(schedOf(s)!.enabled, true);

  const t = await stored("e2.sh", { atTime: "07:00", enabled: true });
  hub("enabled", "interval", "save");
  drivePicks("Every 5 minutes");
  await configureSchedule(store, t);
  assert.equal(schedOf(t)!.enabled, false, "a deliberate off stays off");
});

test("last run details survive an edit", async () => {
  const s = await stored("l.sh", { atTime: "07:00", enabled: true, lastRun: 123, lastOutcome: "failure", lastReportPath: "/r.md" });
  hub("runOnStartup", "save");
  await configureSchedule(store, s);
  const saved = schedOf(s)!;
  assert.deepEqual([saved.lastRun, saved.lastOutcome, saved.lastReportPath], [123, "failure", "/r.md"]);
});

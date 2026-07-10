// Unit tests for the next-scheduled-run status-bar item's action menu. The menu is
// the item's only affordance, so what it offers — and what each entry actually does —
// is behavior, not chrome: the item previously answered none of the questions it
// raises (where is the report, how do I change it, how do I turn it off, how do I
// hide it), which is the defect this menu exists to close.
//
// The `vscode` stub drives showQuickPick through a settable handler, so each test
// picks one entry by label and asserts the side effect (a command dispatched, a
// schedule persisted, a setting written, an editor raised).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setPickHandler,
  __resetHandlers,
  __recordedCommands,
  __resetRecordedCommands,
  __openedDocuments,
  __resetOpenedDocuments,
  __resetConfig,
  __getConfig,
} from "./_stub/vscode";
import { showScheduleStatusBarActions } from "../views/scheduleStatusBarActions";
import { recordLastReport, clearLastReport } from "../exec/lastReport";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut, ShortcutSchedule } from "../model/shortcut";

const NEXT_RUN_AT = Date.parse("2026-07-13T08:00:00");

function shortcut(schedule?: ShortcutSchedule): Shortcut {
  return {
    id: "routine.morning",
    label: "Morning routine",
    path: "",
    scope: "project",
    order: 0,
    schedule,
  } as Shortcut;
}

// A store standing in for the real one: only findShortcut / updateShortcutSchedule are
// reached by the menu, and the saved schedule is captured for assertion.
function fakeStore(live: Shortcut): {
  store: ShortcutStore;
  saved(): ShortcutSchedule | undefined;
} {
  let saved: ShortcutSchedule | undefined;
  const store = {
    findShortcut: (id: string) => (id === live.id ? live : undefined),
    updateShortcutSchedule: async (_s: Shortcut, next: ShortcutSchedule | undefined) => {
      saved = next;
    },
  } as unknown as ShortcutStore;
  return { store, saved: () => saved };
}

// Choose the offered entry whose label contains `fragment`, and run it. Fails loudly
// when the menu does not offer it, so a removed entry breaks the test rather than
// silently canceling the picker.
function pick(fragment: string): void {
  __setPickHandler(async (items) => {
    const match = (items as Array<{ label: string }>).find((i) => i.label.includes(fragment));
    assert.ok(match, `the menu should offer an entry containing "${fragment}"`);
    return match;
  });
}

// Every label the menu offered, captured by canceling the picker.
async function offeredLabels(store: ShortcutStore, target: Shortcut): Promise<string[]> {
  let labels: string[] = [];
  __setPickHandler(async (items) => {
    labels = (items as Array<{ label: string }>).map((i) => i.label);
    return undefined;
  });
  await showScheduleStatusBarActions(store, target, NEXT_RUN_AT);
  return labels;
}

beforeEach(() => {
  __resetHandlers();
  __resetRecordedCommands();
  __resetOpenedDocuments();
  __resetConfig();
  clearLastReport("routine.morning");
});

afterEach(() => {
  __resetHandlers();
  __resetRecordedCommands();
  __resetOpenedDocuments();
  __resetConfig();
  clearLastReport("routine.morning");
});

test("the last report leads the menu when the run wrote one", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  recordLastReport(target.id, "/reports/morning.md");
  const labels = await offeredLabels(fakeStore(target).store, target);
  assert.match(labels[0]!, /Open the last report/, "the report the run wrote leads the menu");
});

test("no report yet: the menu omits that entry and still offers the Schedule screen", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  const labels = await offeredLabels(fakeStore(target).store, target);
  assert.ok(
    !labels.some((l) => l.includes("Open the last report")),
    "an absent report is not offered"
  );
  assert.match(labels[0]!, /Saropa Schedule screen/, "the durable report index leads instead");
});

test("a shortcut with no schedule is not offered a turn-off entry", async () => {
  const target = shortcut(undefined);
  const labels = await offeredLabels(fakeStore(target).store, target);
  assert.ok(!labels.some((l) => l.includes("Turn off")), "nothing to turn off");
  assert.ok(labels.some((l) => l.includes("Hide this next-run indicator")), "hiding still offered");
});

test("choosing the last report raises an editor for it", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  recordLastReport(target.id, "/reports/morning.md");
  pick("Open the last report");
  await showScheduleStatusBarActions(fakeStore(target).store, target, NEXT_RUN_AT);
  assert.deepEqual(__openedDocuments(), ["/reports/morning.md"]);
});

test("choosing Run now dispatches the shortcut by its id", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  pick("Run Morning routine now");
  await showScheduleStatusBarActions(fakeStore(target).store, target, NEXT_RUN_AT);
  assert.deepEqual(__recordedCommands(), [
    { command: "saropaWorkspace.runPinById", args: ["routine.morning"] },
  ]);
});

test("choosing Change when it runs opens the schedule editor for that shortcut", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  pick("Change when");
  await showScheduleStatusBarActions(fakeStore(target).store, target, NEXT_RUN_AT);
  assert.deepEqual(__recordedCommands(), [
    { command: "saropaWorkspace.configureSchedule", args: [target] },
  ]);
});

test("turning the schedule off keeps the time and clears only `enabled`", async () => {
  // Regression: the action must write the LIVE schedule read at pick time, not a
  // snapshot taken when the menu was built — updateShortcutSchedule replaces the whole
  // object, so a stale snapshot would discard a cron the user changed meanwhile.
  const target = shortcut({ atTime: "08:00", enabled: true });
  const { store, saved } = fakeStore(target);
  target.schedule = { atTime: "09:30", cron: "0 9 * * 1-5", enabled: true };
  pick("Turn off the schedule");
  await showScheduleStatusBarActions(store, target, NEXT_RUN_AT);
  assert.deepEqual(saved(), { atTime: "09:30", cron: "0 9 * * 1-5", enabled: false });
});

test("hiding the indicator writes the setting that suppresses it", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  pick("Hide this next-run indicator");
  await showScheduleStatusBarActions(fakeStore(target).store, target, NEXT_RUN_AT);
  assert.equal(__getConfig("saropaWorkspace", "showScheduleStatusBar"), false);
});

test("canceling the menu changes nothing", async () => {
  const target = shortcut({ atTime: "08:00", enabled: true });
  const { store, saved } = fakeStore(target);
  __setPickHandler(async () => undefined);
  await showScheduleStatusBarActions(store, target, NEXT_RUN_AT);
  assert.deepEqual(__recordedCommands(), []);
  assert.equal(saved(), undefined);
  assert.equal(__getConfig("saropaWorkspace", "showScheduleStatusBar"), undefined);
});

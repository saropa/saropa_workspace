// Tests for the cron builder: every preset produces the exact cron string, prompts
// are validated, and a canceled step leaves the schedule untouched.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPickHandler, __setInputHandler, __resetHandlers } from "./_stub/vscode";
import { editCron, WEEKDAY_LABELS } from "../commands/configureScheduleCron";
import { parseCron } from "../exec/scheduleCron";
import type { WorkSchedule } from "../commands/scheduleModel";

interface Row {
  label: string;
  detail?: string;
  action?: string;
  day?: number;
  minutes?: number;
}
interface InputOptions {
  prompt?: string;
  value?: string;
  title?: string;
  validateInput?: (v: string) => string | undefined;
}

const PRESET = {
  clear: "$(circle-slash) No cron schedule",
  weekdayAt: "$(briefcase) Every weekday at a time...",
  dailyAt: "$(clock) Every day at a time...",
  weeklyAt: "$(calendar) On a weekday each week at a time...",
  monthlyAt: "$(calendar) On the 1st of each month at a time...",
  workHours: "$(watch) Every few minutes during work hours (Mon-Fri 9-5)...",
  hourly: "$(sync) Every hour, on the hour",
  advanced: "$(edit) Advanced: type a cron expression...",
} as const;

let picks: Row[][];
let inputs: InputOptions[];

// Answers the pick prompts in order: each entry is a label (or predicate), or undefined to cancel.
function pickSequence(...answers: Array<string | undefined>): void {
  let n = 0;
  __setPickHandler(async (items) => {
    picks.push([...items] as Row[]);
    const answer = answers[n++];
    return answer === undefined ? undefined : (items as Row[]).find((r) => r.label === answer);
  });
}

function typed(...values: Array<string | undefined>): void {
  let n = 0;
  __setInputHandler(async (opts) => {
    inputs.push(opts as InputOptions);
    return values[n++];
  });
}

const work = (extra: Partial<WorkSchedule> = {}): WorkSchedule => ({ enabled: true, ...extra });

beforeEach(() => {
  picks = [];
  inputs = [];
  __resetHandlers();
});

afterEach(() => __resetHandlers());

test("the weekday names run Sunday first like Date.getDay", () => {
  assert.deepEqual(WEEKDAY_LABELS, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
});

test("the preset menu lists the eight choices in order and shows the current cron on the advanced row", async () => {
  pickSequence(undefined);
  await editCron(work({ cron: "5 4 * * *" }), "Title");
  assert.deepEqual(picks[0].map((r) => r.label), Object.values(PRESET));
  assert.deepEqual(picks[0].map((r) => r.detail), [undefined, undefined, undefined, undefined, undefined, undefined, undefined, "5 4 * * *"]);
});

test("dismissing the menu leaves the cron as it was", async () => {
  const w = work({ cron: "1 2 3 4 5" });
  pickSequence(undefined);
  await editCron(w, "T");
  assert.equal(w.cron, "1 2 3 4 5");
});

test("clearing removes the cron, and hourly sets the top of every hour", async () => {
  const w = work({ cron: "1 2 3 4 5" });
  pickSequence(PRESET.clear);
  await editCron(w, "T");
  assert.equal(w.cron, undefined);
  pickSequence(PRESET.hourly);
  await editCron(w, "T");
  assert.equal(w.cron, "0 * * * *");
});

test("each time-based preset builds its cron from the typed time", async () => {
  const cases: Array<[string, string]> = [
    [PRESET.weekdayAt, "30 9 * * 1-5"],
    [PRESET.dailyAt, "30 9 * * *"],
    [PRESET.monthlyAt, "30 9 1 * *"],
  ];
  for (const [preset, cron] of cases) {
    const w = work();
    pickSequence(preset);
    typed(" 09:30 ");
    await editCron(w, "T");
    assert.equal(w.cron, cron, preset);
    assert.ok(parseCron(w.cron!), "built cron parses");
  }
});

test("midnight and the last minute of the day build valid cron strings", async () => {
  const w = work();
  pickSequence(PRESET.dailyAt);
  typed("00:00");
  await editCron(w, "T");
  assert.equal(w.cron, "0 0 * * *");
  pickSequence(PRESET.dailyAt);
  typed("23:59");
  await editCron(w, "T");
  assert.equal(w.cron, "59 23 * * *");
});

test("canceling the time prompt leaves the cron alone", async () => {
  const w = work({ cron: "1 1 * * *" });
  pickSequence(PRESET.dailyAt);
  typed(undefined);
  await editCron(w, "T");
  assert.equal(w.cron, "1 1 * * *");
});

test("the time prompt starts from the schedule's daily time and rejects a bad time", async () => {
  pickSequence(PRESET.dailyAt);
  typed(undefined);
  await editCron(work({ atTime: "07:15" }), "My title");
  assert.equal(inputs[0].value, "07:15");
  assert.equal(inputs[0].title, "My title");
  assert.equal(inputs[0].prompt, "Time of day to run, 24-hour HH:mm.");
  assert.equal(inputs[0].validateInput?.("25:00"), "Enter a 24-hour time as HH:mm (00:00-23:59).");
  assert.equal(inputs[0].validateInput?.("nine"), "Enter a 24-hour time as HH:mm (00:00-23:59).");
  assert.equal(inputs[0].validateInput?.(" 08:05 "), undefined);
});

test("the weekly preset asks for the day, then the time, and uses the day's number", async () => {
  const w = work();
  pickSequence(PRESET.weeklyAt, "Fri");
  typed("17:45");
  await editCron(w, "T");
  assert.deepEqual(picks[1].map((r) => r.label), WEEKDAY_LABELS);
  assert.equal(w.cron, "45 17 * * 5");
  pickSequence(PRESET.weeklyAt, "Sun");
  typed("06:00");
  await editCron(w, "T");
  assert.equal(w.cron, "0 6 * * 0");
});

test("canceling the weekday or the time of the weekly preset changes nothing", async () => {
  const w = work({ cron: "9 9 * * 9" });
  pickSequence(PRESET.weeklyAt, undefined);
  await editCron(w, "T");
  assert.equal(w.cron, "9 9 * * 9");
  pickSequence(PRESET.weeklyAt, "Mon");
  typed(undefined);
  await editCron(w, "T");
  assert.equal(w.cron, "9 9 * * 9");
});

test("work hours offers four cadences; sub-hourly uses a step and hourly uses minute zero", async () => {
  const expected: Array<[string, string]> = [
    ["Every 15 minutes", "*/15 9-17 * * 1-5"],
    ["Every 20 minutes", "*/20 9-17 * * 1-5"],
    ["Every 30 minutes", "*/30 9-17 * * 1-5"],
    ["Every 60 minutes", "0 9-17 * * 1-5"],
  ];
  for (const [label, cron] of expected) {
    const w = work();
    pickSequence(PRESET.workHours, label);
    await editCron(w, "T");
    assert.equal(w.cron, cron, label);
    assert.ok(parseCron(cron));
  }
  assert.deepEqual(picks[1].map((r) => r.label), expected.map((e) => e[0]));
});

test("canceling the work-hours cadence changes nothing", async () => {
  const w = work({ cron: "1 1 1 1 1" });
  pickSequence(PRESET.workHours, undefined);
  await editCron(w, "T");
  assert.equal(w.cron, "1 1 1 1 1");
});

test("the advanced path stores the trimmed expression and an empty entry clears it", async () => {
  const w = work({ cron: "0 9 * * 1-5" });
  pickSequence(PRESET.advanced);
  typed("  */5 * * * *  ");
  await editCron(w, "T");
  assert.equal(w.cron, "*/5 * * * *");
  assert.equal(inputs[0].value, "0 9 * * 1-5");
  pickSequence(PRESET.advanced);
  typed("   ");
  await editCron(w, "T");
  assert.equal(w.cron, undefined);
});

test("the advanced prompt accepts a valid cron or nothing, and rejects anything else", async () => {
  pickSequence(PRESET.advanced);
  typed(undefined);
  await editCron(work(), "T");
  const validate = inputs[0].validateInput!;
  assert.equal(validate(""), undefined);
  assert.equal(validate("   "), undefined);
  assert.equal(validate("0 9 * * 1-5"), undefined);
  const message = "Enter a valid 5-field cron expression (e.g. 0 9 * * 1-5), or leave empty to clear.";
  assert.equal(validate("every day"), message);
  assert.equal(validate("61 * * * *"), message);
  assert.equal(validate("* * * *"), message);
});

test("canceling the advanced prompt leaves the cron as it was", async () => {
  const w = work({ cron: "2 2 * * *" });
  pickSequence(PRESET.advanced);
  typed(undefined);
  await editCron(w, "T");
  assert.equal(w.cron, "2 2 * * *");
});

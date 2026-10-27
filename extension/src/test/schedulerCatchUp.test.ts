// Catch-up at start for the recipes that feed the Release Board: a missed job runs once however
// many days were missed, one at a time, cheapest first; a heavy job waits for the editor to be
// idle; each job's state is published; a schedule that did not opt in is never run silently.
// The store is a small fake, and the launcher is injected, so no process is started.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { Scheduler } from "../exec/scheduler";
import { feedJobs } from "../exec/feedJobs";
import type { Shortcut, ShortcutSchedule } from "../model/shortcut";
import type { ShortcutStore } from "../model/shortcutStore";

const DAY = 86400000;
const SECTION = "saropaWorkspace.releaseBoard.recipeEvidence";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const ACTIONS: Record<string, Shortcut["action"]> = {
  other: { kind: "shell", shellCommand: "echo other" },
  build: { kind: "command", commandId: "saropaWorkspace.recipe.ciStatus" },
  lint: { kind: "shell", shellCommand: "npx eslint .", reportFile: "reports/$datedir_workspace/$datedir_workspace_$time_lint.txt" },
  tests: { kind: "shell", shellCommand: "npm test", reportFile: "reports/$datedir_workspace/$datedir_workspace_$time_tests.txt" },
  deps: { kind: "command", commandId: "saropaWorkspace.recipe.pubspecOutdated" },
};

// A shortcut missed for five days by default, with catch-up on.
function job(id: string, over: Partial<ShortcutSchedule> = {}): Shortcut {
  return {
    id,
    path: "",
    label: id,
    scope: "project",
    order: 0,
    action: ACTIONS[id],
    schedule: { enabled: true, atTime: "05:00", catchUp: true, lastRun: Date.now() - 5 * DAY, ...over },
  } as Shortcut;
}

function fakeStore(list: Shortcut[]): ShortcutStore {
  return {
    getProjectShortcuts: () => list,
    getGlobalShortcuts: () => [],
    findShortcut: (id: string) => list.find((s) => s.id === id),
    onDidChange: () => ({ dispose: () => undefined }),
    updateShortcutScheduleLastRun: async (s: Shortcut, at: number) => {
      s.schedule = { ...s.schedule!, lastRun: at };
    },
  } as unknown as ShortcutStore;
}

async function startUp(scheduler: Scheduler): Promise<void> {
  scheduler.runStartupShortcuts();
  mock.timers.tick(2_000);
  await flush();
}

beforeEach(() => {
  __resetConfig();
  feedJobs.reset();
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
  __resetConfig();
  feedJobs.reset();
});

test("a job missed for five days runs exactly once and its schedule advances", async () => {
  const build = job("build");
  const launched: string[] = [];
  const scheduler = new Scheduler(fakeStore([build]), { launch: async (s) => void launched.push(s.id) });
  try {
    const before = Date.now();
    await startUp(scheduler);
    assert.deepEqual(launched, ["build"]);
    assert.ok(build.schedule!.lastRun! >= before, "lastRun moved to the catch-up time");
  } finally {
    scheduler.dispose();
  }
});

test("catch-up runs build, lint, tests, then dependencies, after jobs that feed no row", async () => {
  const launched: string[] = [];
  const list = [job("deps"), job("tests"), job("lint"), job("other"), job("build")];
  const scheduler = new Scheduler(fakeStore(list), { launch: async (s) => void launched.push(s.id) });
  try {
    await startUp(scheduler);
    assert.deepEqual(launched, ["other", "build", "lint", "tests", "deps"]);
  } finally {
    scheduler.dispose();
  }
});

test("each job is published as running, then cleared, before the next one starts", async () => {
  const log: string[] = [];
  const list = [job("lint"), job("build")];
  const sub = feedJobs.onDidChange((id) => log.push(`${id}:${feedJobs.get(id)?.state ?? "cleared"}`));
  const scheduler = new Scheduler(fakeStore(list), { launch: async (s) => void log.push(`launch:${s.id}`) });
  try {
    await startUp(scheduler);
    assert.deepEqual(log, [
      "build:queued",
      "lint:queued",
      "build:running",
      "launch:build",
      "build:cleared",
      "lint:running",
      "launch:lint",
      "lint:cleared",
    ]);
  } finally {
    sub.dispose();
    scheduler.dispose();
  }
});

test("a heavy job waits for two quiet minutes; the cheap jobs do not wait", async () => {
  const launched: string[] = [];
  let idle = 0;
  const list = [job("tests"), job("build")];
  const scheduler = new Scheduler(fakeStore(list), { launch: async (s) => void launched.push(s.id), idleMs: () => idle });
  try {
    await startUp(scheduler);
    assert.deepEqual(launched, ["build"]);
    assert.deepEqual(feedJobs.get("tests"), { state: "queued" });
    idle = 119_000;
    mock.timers.tick(15_000);
    await flush();
    assert.deepEqual(launched, ["build"], "119 seconds of quiet is not enough");
    idle = 120_000;
    mock.timers.tick(15_000);
    await flush();
    assert.deepEqual(launched, ["build", "tests"]);
    assert.equal(feedJobs.get("tests"), undefined);
  } finally {
    scheduler.dispose();
  }
});

test("idleMinutes 0 starts a heavy job at once", async () => {
  __setConfig(SECTION, "idleMinutes", 0);
  const launched: string[] = [];
  const scheduler = new Scheduler(fakeStore([job("tests")]), { launch: async (s) => void launched.push(s.id), idleMs: () => 0 });
  try {
    await startUp(scheduler);
    assert.deepEqual(launched, ["tests"]);
  } finally {
    scheduler.dispose();
  }
});

test("a job that fails to start publishes why, and the next job still runs", async () => {
  const launched: string[] = [];
  const list = [job("build"), job("lint")];
  const scheduler = new Scheduler(fakeStore(list), {
    launch: async (s) => {
      if (s.id === "build") {
        throw new Error("gh is not installed");
      }
      launched.push(s.id);
    },
  });
  try {
    await startUp(scheduler);
    assert.deepEqual(feedJobs.get("build"), { state: "failed", reason: "gh is not installed" });
    assert.deepEqual(launched, ["lint"]);
    assert.equal(feedJobs.get("lint"), undefined);
  } finally {
    scheduler.dispose();
  }
});

test("a schedule that did not opt in to catch-up is not run silently", async () => {
  const launched: string[] = [];
  const off = job("build", { catchUp: false });
  const unset = job("lint", { catchUp: undefined });
  const scheduler = new Scheduler(fakeStore([off, unset]), { launch: async (s) => void launched.push(s.id) });
  try {
    await startUp(scheduler);
    assert.deepEqual(launched, []);
    assert.equal(feedJobs.get("build"), undefined);
    assert.equal(off.schedule!.catchUp, false, "the user's choice is untouched");
  } finally {
    scheduler.dispose();
  }
});

test("with recipe evidence off, catch-up keeps the stored order, never waits and publishes nothing", async () => {
  __setConfig(SECTION, "enabled", false);
  const launched: string[] = [];
  const log: string[] = [];
  const sub = feedJobs.onDidChange((id) => log.push(id));
  const scheduler = new Scheduler(fakeStore([job("tests"), job("build")]), { launch: async (s) => void launched.push(s.id), idleMs: () => 0 });
  try {
    await startUp(scheduler);
    assert.deepEqual(launched, ["tests", "build"]);
    assert.deepEqual(log, []);
  } finally {
    sub.dispose();
    scheduler.dispose();
  }
});

test("a run just handled inside the reload window is not caught up again", async () => {
  const launched: string[] = [];
  const recent = job("build", { lastRun: Date.now() - 5_000 });
  const scheduler = new Scheduler(fakeStore([recent]), { launch: async (s) => void launched.push(s.id) });
  try {
    await startUp(scheduler);
    assert.deepEqual(launched, []);
  } finally {
    scheduler.dispose();
  }
});

test("disposing while a heavy job waits for quiet ends the pass without running it", async () => {
  const launched: string[] = [];
  const scheduler = new Scheduler(fakeStore([job("tests")]), { launch: async (s) => void launched.push(s.id), idleMs: () => 0 });
  await startUp(scheduler);
  scheduler.dispose();
  await flush();
  mock.timers.tick(60_000);
  await flush();
  assert.deepEqual(launched, []);
});

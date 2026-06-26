// Unit tests for the Scheduler's run-on-startup pass (roadmap 2.2). The scheduler
// drives in-process timers off a REAL ShortcutStore (the same fs-backed store shim the
// shortcutStore / branchSets tests use), so these exercise the actual eligibility and
// advance logic: which startup pins fire, which are skipped, and that a skip still
// records lastRun so the schedule advances rather than tight-looping.
//
// IMPORTANT — what is NOT driven here: a startup shortcut that actually RUNS reaches
// runPin -> the terminal/background launchers, which need vscode.window.createTerminal
// (not modeled by the stub). So every shortcut in these tests is arranged to hit a SKIP
// branch (paused / not-on-startup / within the reload-dedup window / interactive
// token), each of which returns before any launch. The skip branches are the ones
// with the subtle invariant worth pinning down (advance-on-skip), so this is the
// behavior worth covering without the extension host.
//
// node:test mock timers stand in for the 1.5s deferred-startup delay so the pass
// runs deterministically without a real wall-clock wait.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { Scheduler } from "../exec/scheduler";
import type { ShortcutSchedule } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

// Let the timer-driven, fire-and-forget fireStartupShortcuts (kicked off via `void` from
// the timer callback, so not awaitable by the caller) settle its async store IO. The
// store's fs shim is node-backed, so a few macrotask turns cover the read/write.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO (mirrors shortcutStore.test).
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-scheduler-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  mock.timers.reset();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// A store with a single project file shortcut carrying the given schedule. Returns the
// store and the shortcut id so a test can read lastRun back after a pass.
async function storeWithScheduledShortcut(
  relPath: string,
  schedule: ShortcutSchedule
): Promise<{ store: ShortcutStore; pinId: string }> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, relPath)), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === relPath)!;
  await store.updateShortcutSchedule(shortcut, schedule);
  const refreshed = store.getProjectShortcuts().find((p) => p.path === relPath)!;
  return { store, pinId: refreshed.id };
}

function lastRunOf(store: ShortcutStore, pinId: string): number | undefined {
  return store.findShortcut(pinId)?.schedule?.lastRun;
}

// Run the deferred startup pass to completion: advance past the 1.5s delay, then
// flush the async store IO the fire path performs.
async function runStartup(scheduler: Scheduler): Promise<void> {
  scheduler.runStartupShortcuts();
  mock.timers.tick(2_000); // past STARTUP_RUN_DELAY_MS (1.5s)
  await flush();
}

test("a paused run-on-startup pin does not fire (its lastRun is untouched)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  // Seed an old lastRun OUTSIDE the dedup window so the only thing keeping the shortcut
  // from firing is the pause — isolating the paused guard from the dedup guard.
  const stale = Date.now() - 10 * 60_000;
  const { store, pinId } = await storeWithScheduledShortcut("paused.sh", {
    enabled: true,
    runOnStartup: true,
    lastRun: stale,
  });
  // Pause the shortcut through the real toggle: an unattended startup fire must skip it.
  await store.setShortcutPaused(store.findShortcut(pinId)!, true);

  const scheduler = new Scheduler(store);
  try {
    await runStartup(scheduler);
    // A paused shortcut is skipped before fire(), so lastRun is never refreshed by the pass.
    assert.equal(lastRunOf(store, pinId), stale, "the paused pin's lastRun is untouched");
  } finally {
    scheduler.dispose();
  }
});

test("a schedule without runOnStartup is not fired by the startup pass", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  // A time-based-only schedule (no runOnStartup) must not be picked up by the
  // startup pass — it fires via its time slot, not on activation.
  const { store, pinId } = await storeWithScheduledShortcut("daily.sh", {
    enabled: true,
    atTime: "09:00",
  });
  const scheduler = new Scheduler(store);
  try {
    await runStartup(scheduler);
    assert.equal(lastRunOf(store, pinId), undefined, "no startup fire was recorded");
  } finally {
    scheduler.dispose();
  }
});

test("a startup pin that fired within the reload-dedup window is skipped", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const recent = Date.now() - 5_000; // well inside the 2-minute reload window
  const { store, pinId } = await storeWithScheduledShortcut("startup.sh", {
    enabled: true,
    runOnStartup: true,
    lastRun: recent,
  });
  const scheduler = new Scheduler(store);
  try {
    await runStartup(scheduler);
    // Skipped as a reload re-run: lastRun is left exactly as it was, not refreshed.
    assert.equal(
      lastRunOf(store, pinId),
      recent,
      "a within-window startup pin is not re-run"
    );
  } finally {
    scheduler.dispose();
  }
});

test("a startup pin needing interactive input is skipped but its schedule still advances", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  // An interactive token cannot be answered in an unattended pass, so the shortcut is
  // skipped — but fire() still records lastRun so the slot does not tight-loop. The
  // ${prompt:} lives in an arg, which planRun/hasInteractiveTokens inspects.
  const before = Date.now();
  const { store, pinId } = await storeWithScheduledShortcut("interactive.sh", {
    enabled: true,
    runOnStartup: true,
  });
  // Attach an interactive-token exec config through the real updater. The
  // ${prompt:} in an arg is what hasInteractiveTokens detects, so fire() takes the
  // interactive-skip branch (which still advances lastRun) rather than launching.
  await store.updateShortcutExec(store.findShortcut(pinId)!, {
    command: "echo",
    args: ["${prompt:name}"],
  });

  const scheduler = new Scheduler(store);
  try {
    await runStartup(scheduler);
    const after = lastRunOf(store, pinId);
    assert.ok(after !== undefined, "the skip still advanced the schedule");
    assert.ok(after! >= before, "lastRun was set to the fire time, not the old value");
  } finally {
    scheduler.dispose();
  }
});

test("runStartupPins on a disposed scheduler is inert (no timer armed)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { store, pinId } = await storeWithScheduledShortcut("startup.sh", {
    enabled: true,
    runOnStartup: true,
  });
  const scheduler = new Scheduler(store);
  scheduler.dispose();
  // After dispose, the startup pass is a no-op: ticking past the delay fires nothing.
  scheduler.runStartupShortcuts();
  mock.timers.tick(2_000);
  await flush();
  assert.equal(lastRunOf(store, pinId), undefined, "a disposed scheduler does not fire");
});

test("dispose clears an armed schedule timer so a far slot never fires after teardown", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  // A near-future interval slot arms a real timer via start(); dispose must clear it
  // so it cannot fire into a torn-down store.
  const { store, pinId } = await storeWithScheduledShortcut("interval.sh", {
    enabled: true,
    everyMs: 1_000,
  });
  const scheduler = new Scheduler(store);
  scheduler.start();
  scheduler.dispose();
  // Advance well past the interval; a cleared timer must not fire.
  mock.timers.tick(5_000);
  await flush();
  assert.equal(
    lastRunOf(store, pinId),
    undefined,
    "no fire happened after dispose cleared the timer"
  );
});

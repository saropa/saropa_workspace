// Tests for the background engine wiring: what it constructs and hands to the context for
// disposal, the scheduler it returns, and the command that restores dismissed pinned-tab offers.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  __registeredCommands, __setConfig, __resetConfig, __infoMessages, __resetInfo, __resetHosts, __resetHandlers,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { wireBackgroundEngines } from "../activation/wiringEngines";
import { Scheduler } from "../exec/scheduler";
import { IdleMonitor } from "../exec/idleMonitor";
import { ChainRunner } from "../exec/chainRunner";
import { GitEventWatcher } from "../exec/systemEvents";
import { Heartbeat } from "../exec/heartbeat";
import { processRegistry } from "../exec/processRegistry";
import { metricBadges } from "../exec/metricBadges";
import { SuggestionTracker } from "../views/suggestions";
import { TabPinSuggester } from "../views/tabPinSuggestions";
import { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let context: ReturnType<typeof registrarContext>;
let store: ShortcutStore;
let scheduler: Scheduler;

const STATE_KEY = "saropaWorkspace.tabPinSuggest.state";

beforeEach(async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  fx = createFsFixture("sw-engines-");
  store = new ShortcutStore(fakeContext());
  await store.init();
  context = registrarContext();
  scheduler = wireBackgroundEngines(context, store);
});

afterEach(() => {
  for (const s of context.subscriptions) {
    s.dispose();
  }
  mock.timers.reset();
  __resetConfig();
  __resetInfo();
  __resetHosts();
  __resetHandlers();
  fx.remove();
});

const owned = (type: new (...args: never[]) => unknown): number =>
  context.subscriptions.filter((s) => s instanceof type).length;

test("it returns the scheduler, which the context also owns so every timer is cleared on shutdown", () => {
  assert.ok(scheduler instanceof Scheduler);
  assert.ok(context.subscriptions.includes(scheduler));
});

test("every engine is handed to the context exactly once", () => {
  assert.deepEqual(
    [Scheduler, IdleMonitor, ChainRunner, GitEventWatcher, Heartbeat, SuggestionTracker, TabPinSuggester].map(owned),
    [1, 1, 1, 1, 1, 1, 1]
  );
  assert.ok(context.subscriptions.includes(processRegistry));
  assert.ok(context.subscriptions.includes(metricBadges));
});

test("restoring tab suggestions clears the dismissed list and tells how many came back", async () => {
  const ctx = context as unknown as { globalState: { update(k: string, v: unknown): Thenable<void>; get<T>(k: string): T | undefined } };
  await ctx.globalState.update(STATE_KEY, { firstPinnedAt: { "a.ts": 1 }, dismissed: ["a.ts", "b.ts", "c.ts"] });
  // The engines were wired on a context with its own state; the suggester reads that same context.
  await (__registeredCommands().get("saropaWorkspace.restoreTabSuggestions") as () => Promise<void>)();
  assert.deepEqual([...__infoMessages()], [l10n("tabSuggest.restored", { count: 3 })]);
  const state = ctx.globalState.get<{ dismissed: string[]; firstPinnedAt: Record<string, number> }>(STATE_KEY)!;
  assert.deepEqual([state.dismissed, state.firstPinnedAt], [[], { "a.ts": 1 }]);
});

test("restoring with nothing dismissed reports zero", async () => {
  await (__registeredCommands().get("saropaWorkspace.restoreTabSuggestions") as () => Promise<void>)();
  assert.deepEqual([...__infoMessages()], [l10n("tabSuggest.restored", { count: 0 })]);
});


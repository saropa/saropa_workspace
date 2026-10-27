// Tests for the status bar wiring: the schedule and set indicators it creates, and the three
// commands that need the Shortcuts view handle (the next-run menu, reveal, and keyboard peek).

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  EventEmitter, __registeredCommands, __statusBarItems, __resetHosts, __recordedCommands, __resetRecordedCommands,
  __resetHandlers, __resetConfig,
} from "./_stub/vscode";
import { registrarContext } from "./registrarCheck";
import { drivePicks } from "./uiDrivers";
import { setupStatusBars } from "../activation/wiringStatusBars";
import { formatWhen } from "../views/scheduleStatusBar";
import { ShortcutTreeItem } from "../views/shortcutTreeItem";
import type { ShortcutStore } from "../model/shortcutStore";
import type { ShortcutsTreeProvider } from "../views/shortcutsTreeProvider";
import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";
import type * as vscode from "vscode";

let context: ReturnType<typeof registrarContext>;
let shortcuts: Shortcut[];
let revealed: Array<{ item: unknown; options: unknown }>;
let selection: unknown[];
let changes: InstanceType<typeof EventEmitter<void>>;

const NOW = new Date(2026, 6, 13, 8, 0, 0).getTime();
const NINE = new Date(2026, 6, 13, 8, 20, 0).getTime();
const morning = (): Shortcut =>
  ({ id: "m1", label: "Morning routine", path: "", scope: "project", order: 0, schedule: { enabled: true, atTime: "08:20" } }) as Shortcut;

const store = {
  get onDidChange() { return changes.event; },
  getProjectShortcuts: () => shortcuts,
  getGlobalShortcuts: () => [] as Shortcut[],
  findShortcut: (id: string) => shortcuts.find((s) => s.id === id),
  getSetNames: () => ["Default"],
  getActiveSetName: () => "Default",
} as unknown as ShortcutStore;
const tree = { revealItem: (s: Shortcut) => ({ revealed: s.id }) } as unknown as ShortcutsTreeProvider;
const treeView = {
  get selection() { return selection; },
  reveal: async (item: unknown, options: unknown): Promise<void> => void revealed.push({ item, options }),
} as unknown as vscode.TreeView<vscode.TreeItem>;
const run = (id: string): Promise<unknown> => Promise.resolve(__registeredCommands().get(`saropaWorkspace.${id}`)!());

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: NOW });
  changes = new EventEmitter<void>();
  shortcuts = [morning()];
  revealed = [];
  selection = [];
  context = registrarContext();
  __resetRecordedCommands();
  setupStatusBars(context, store, tree, treeView);
});

afterEach(() => {
  for (const s of context.subscriptions) {
    s.dispose();
  }
  mock.timers.reset();
  __resetConfig();
  __resetHosts();
  __resetHandlers();
});

test("it creates the next-run indicator and the set indicator, and owns both", () => {
  const items = __statusBarItems();
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => [i.alignment, i.command]), [
    [2, "saropaWorkspace.scheduleStatusBarActions"],
    [1, "saropaWorkspace.switchPinSet"],
  ]);
  context.subscriptions.forEach((s) => s.dispose());
  assert.deepEqual(items.map((i) => i.disposed), [true, true]);
});

test("the next-run indicator shows the soonest run inside the lead window", () => {
  const [item] = __statusBarItems();
  assert.equal(item.visible, true);
  assert.equal(item.text, l10n("statusBar.next", { time: formatWhen(NINE) }));
  assert.equal(item.tooltip, l10n("statusBar.tooltip", { name: "Morning routine", time: formatWhen(NINE) }));
});

test("clicking the indicator opens the action menu for the shortcut it shows", async () => {
  const shown = drivePicks(undefined);
  await run("scheduleStatusBarActions");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.title, l10n("statusBar.actions.title", { name: "Morning routine", time: formatWhen(NINE) }));
  assert.ok(shown[0].labels.includes(l10n("statusBar.actions.runNow", { name: "Morning routine" })));
});

test("with nothing scheduled, clicking the indicator and reveal do nothing", async () => {
  shortcuts = [];
  changes.fire();
  const shown = drivePicks();
  await run("scheduleStatusBarActions");
  await run("revealNextScheduled");
  assert.deepEqual([shown, revealed], [[], []]);
  assert.equal(__statusBarItems()[0].visible, false);
});

test("reveal selects, focuses and expands the tree row of the shortcut the indicator shows", async () => {
  await run("revealNextScheduled");
  assert.deepEqual(revealed, [{ item: { revealed: "m1" }, options: { select: true, focus: true, expand: true } }]);
});

test("keyboard peek sends the first selected shortcut row to the peek command", async () => {
  selection = [{ label: "a group" }, new ShortcutTreeItem({ shortcut: morning() })];
  await run("peekFocusedPin");
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as Shortcut).id]), [["saropaWorkspace.peekPin", "m1"]]);
});

test("keyboard peek with nothing, or only other rows, selected does nothing", async () => {
  await run("peekFocusedPin");
  selection = [{ label: "a group" }];
  await run("peekFocusedPin");
  assert.deepEqual(__recordedCommands(), []);
});

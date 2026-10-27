// Tests for the active-set status bar item: hidden for the lone default set or with no
// folder open, shown with the set name and count otherwise, and kept current as the store changes.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, __statusBarItems, __resetHosts, __setWorkspaceFolders, Uri } from "./_stub/vscode";
import { SetStatusBar } from "../views/setStatusBar";
import type { ShortcutStore } from "../model/shortcutStore";
import { l10n } from "../i18n/l10n";

let names: string[];
let active: string;
let changes: InstanceType<typeof EventEmitter<void>>;

const store = {
  get onDidChange() { return changes.event; },
  getSetNames: () => names,
  getActiveSetName: () => active,
} as unknown as ShortcutStore;
const item = (): ReturnType<typeof __statusBarItems>[number] => __statusBarItems()[0];
const openFolder = (): void => __setWorkspaceFolders([{ uri: Uri.file("/proj"), name: "proj", index: 0 }]);

beforeEach(() => {
  changes = new EventEmitter<void>();
  names = ["Default"];
  active = "Default";
  openFolder();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetHosts();
});

test("the item is left-aligned, named, and opens the set switcher", () => {
  new SetStatusBar(store);
  assert.deepEqual([item().alignment, item().priority, item().command], [1, 0, "saropaWorkspace.switchPinSet"]);
  assert.equal((item() as unknown as { name: string }).name, l10n("pinSet.statusBarName"));
});

test("it stays hidden while the only set is the untouched default", () => {
  new SetStatusBar(store);
  assert.equal(item().visible, false);
});

test("a second set shows the active name and the set count", () => {
  names = ["Default", "Work"];
  active = "Work";
  new SetStatusBar(store);
  assert.equal(item().visible, true);
  assert.equal(item().text, "$(layers) Work");
  assert.equal(item().tooltip, "Active shortcut set: Work (2 set(s)). Click to switch or manage sets.");
});

test("a single renamed set is shown", () => {
  names = ["Solo"];
  active = "Solo";
  new SetStatusBar(store);
  assert.equal(item().visible, true);
  assert.equal(item().text, "$(layers) Solo");
});

test("with no folder open it is hidden even when several sets exist", () => {
  __setWorkspaceFolders(undefined);
  names = ["Default", "Work"];
  new SetStatusBar(store);
  assert.equal(item().visible, false);
});

test("a store change shows or hides the item and updates the text", () => {
  new SetStatusBar(store);
  names = ["Default", "Work"];
  active = "Work";
  changes.fire();
  assert.deepEqual([item().visible, item().text], [true, "$(layers) Work"]);
  active = "Default";
  changes.fire();
  assert.equal(item().text, "$(layers) Default");
  names = ["Default"];
  changes.fire();
  assert.equal(item().visible, false);
});

test("dispose removes the item and stops listening", () => {
  const bar = new SetStatusBar(store);
  bar.dispose();
  assert.equal(item().disposed, true);
  names = ["Default", "Work"];
  changes.fire();
  assert.equal(item().visible, false);
});

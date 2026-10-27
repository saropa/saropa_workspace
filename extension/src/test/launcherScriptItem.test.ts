// Unit tests for the script-library launcher row builder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptLauncherItem } from "../views/launcherScriptItem";

const script = { id: "clean", label: "Clean", description: "Remove build output", icon: "trash", tags: ["build", "tidy"], hasParams: false };

test("builds a runnable library row with prefixed id and tag sub line", () => {
  const item = scriptLauncherItem(script);
  assert.equal(item.id, "library:clean");
  assert.equal(item.sub, "build, tidy");
  assert.equal(item.desc, "Remove build output");
  assert.equal(item.icon, "trash");
  assert.equal(item.runnable, true);
  assert.equal(item.openable, false);
  assert.equal(item.headAction, "run");
  assert.equal(item.pane, "scripts");
});

test("a script without parameters has no menu entries", () => {
  assert.deepEqual(scriptLauncherItem(script).menu, []);
});

test("a script with parameters offers the set-parameters action", () => {
  const menu = scriptLauncherItem({ ...script, hasParams: true }).menu;
  assert.equal(menu.length, 1);
  assert.equal(menu[0].command, "saropaWorkspace.setScriptParams");
  assert.equal(menu[0].group, "configure");
});

test("no tags give an empty sub line", () => {
  assert.equal(scriptLauncherItem({ ...script, tags: [] }).sub, "");
});

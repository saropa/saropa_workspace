// Unit tests for the Watches-pane launcher row builder (state-to-icon mapping).

import { test } from "node:test";
import assert from "node:assert/strict";
import { watchLauncherItem } from "../views/launcherWatchItem";

const w = {
  id: "w1",
  label: "Downloads",
  target: "/home/u/Downloads",
  isFile: false,
  mode: "new" as const,
  watchKind: "path" as never,
  enabled: true,
  unseen: 0,
  isGlobal: false,
};

test("an idle local folder watch shows the eye icon and kind/mode text", () => {
  const item = watchLauncherItem(w);
  assert.equal(item.icon, "eye");
  assert.equal(item.color, "foreground");
  assert.match(item.sub!, /^.+ - .+$/);
  assert.equal(item.desc, "/home/u/Downloads");
  assert.equal(item.pane, "watches");
  assert.equal(item.openable, true);
  assert.equal(item.runnable, false);
});

test("a disabled watch is dimmed and marked off, even when global or unseen", () => {
  const item = watchLauncherItem({ ...w, enabled: false, unseen: 4, isGlobal: true });
  assert.equal(item.icon, "eye-closed");
  assert.equal(item.color, "descriptionForeground");
  assert.match(item.sub!, /^off - /);
});

test("unseen changes on a local watch show a bell and the count", () => {
  const item = watchLauncherItem({ ...w, unseen: 3 });
  assert.equal(item.icon, "bell-dot");
  assert.equal(item.color, "charts.blue");
  assert.match(item.sub!, /3/);
});

test("global watches use the globe, highlighted only when unseen", () => {
  const quiet = watchLauncherItem({ ...w, isGlobal: true });
  const loud = watchLauncherItem({ ...w, isGlobal: true, unseen: 2 });
  assert.equal(quiet.icon, "globe");
  assert.equal(quiet.color, "foreground");
  assert.equal(loud.icon, "globe");
  assert.equal(loud.color, "charts.blue");
});

test("a repo watch keeps the GitHub icon when unseen and names the repo kind", () => {
  const idle = watchLauncherItem({ ...w, watchKind: "repo" });
  const unseen = watchLauncherItem({ ...w, watchKind: "repo", unseen: 5 });
  assert.equal(idle.icon, "github");
  assert.equal(unseen.icon, "github");
  assert.equal(unseen.color, "charts.blue");
});

test("a file watch and a folder watch read differently", () => {
  assert.notEqual(watchLauncherItem({ ...w, isFile: true }).sub, watchLauncherItem(w).sub);
  assert.notEqual(watchLauncherItem({ ...w, mode: "changed" }).sub, watchLauncherItem(w).sub);
});

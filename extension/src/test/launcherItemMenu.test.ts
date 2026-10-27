// Tests for the launcher card's right-click menu builder: which rows each pane and item
// kind gets, in what order, with which commands, icons and groups.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMenu } from "../views/launcherItemMenu";
import type { Shortcut } from "../model/shortcut";
import type { LauncherMenuEntry } from "../views/launcherItems";

const shortcut = (over: Partial<Shortcut> = {}): Shortcut => ({ id: "s1", path: "a.sh", scope: "project", order: 0, ...over });

/** The top-level rows as "command|label" pairs, so an order change shows up in the diff. */
const rows = (menu: readonly LauncherMenuEntry[]): string[] => menu.map((m) => `${m.command}|${m.label}`);

test("a stored file shortcut gets open, run, three submenus, rename and remove in that order", () => {
  const menu = buildMenu(shortcut(), "mine", true);
  assert.deepEqual(rows(menu), [
    "saropaWorkspace.openPin|Open",
    "saropaWorkspace.runPin|Run",
    "|Configure & Schedule",
    "|Appearance",
    "|File Actions",
    "saropaWorkspace.renamePin|Rename…",
    "saropaWorkspace.unpin|Remove",
  ]);
});

test("a stored action shortcut (not a file) has no Open, no File Actions and no live-metric row", () => {
  const menu = buildMenu(shortcut(), "mine", false);
  assert.deepEqual(rows(menu), [
    "saropaWorkspace.runPin|Run",
    "|Configure & Schedule",
    "|Appearance",
    "saropaWorkspace.renamePin|Rename…",
    "saropaWorkspace.unpin|Remove",
  ]);
  const appearance = menu.find((m) => m.label === "Appearance");
  assert.deepEqual(rows(appearance?.children ?? []), ["saropaWorkspace.customizeShortcut|Customize…"]);
});

test("only Remove is marked dangerous", () => {
  const menu = buildMenu(shortcut(), "mine", true);
  const all = menu.flatMap((m) => [m, ...(m.children ?? [])]);
  assert.deepEqual(all.filter((m) => m.danger).map((m) => m.command), ["saropaWorkspace.unpin"]);
});

test("the Configure submenu lists the six configure actions with a Pause row", () => {
  const configure = buildMenu(shortcut(), "mine", true)[2];
  assert.equal(configure.command, "");
  assert.equal(configure.icon, "gear");
  assert.equal(configure.group, "configure");
  assert.deepEqual(configure.children?.map((c) => [c.command, c.icon, c.group, c.label]), [
    ["saropaWorkspace.runWith", "wrench", "configure", "Run With…"],
    ["saropaWorkspace.configureRun", "gear", "configure", "Configure Run…"],
    ["saropaWorkspace.setPinParams", "list-flat", "configure", "Set Params…"],
    ["saropaWorkspace.configureSchedule", "clock", "configure", "Configure Schedule…"],
    ["saropaWorkspace.configureTriggers", "broadcast", "configure", "Configure Triggers…"],
    ["saropaWorkspace.pausePin", "debug-pause", "configure", "Pause"],
  ]);
});

test("a paused shortcut shows Resume instead of Pause", () => {
  const configure = buildMenu(shortcut({ paused: true }), "mine", true)[2];
  const last = configure.children?.[5];
  assert.deepEqual([last?.command, last?.label, last?.icon], ["saropaWorkspace.unpausePin", "Resume", "debug-start"]);
  assert.equal(configure.children?.some((c) => c.command === "saropaWorkspace.pausePin"), false);
});

test("the Appearance submenu adds the live metric row for a file", () => {
  const appearance = buildMenu(shortcut(), "mine", true)[3];
  assert.equal(appearance.icon, "paintcan");
  assert.deepEqual(appearance.children?.map((c) => [c.command, c.icon, c.label]), [
    ["saropaWorkspace.customizeShortcut", "paintcan", "Customize…"],
    ["saropaWorkspace.setMetric", "dashboard", "Set Live Metric…"],
  ]);
});

test("the File Actions submenu has the three file operations and a Mask row", () => {
  const file = buildMenu(shortcut(), "mine", true)[4];
  assert.equal(file.icon, "files");
  assert.deepEqual(file.children?.map((c) => [c.command, c.icon, c.label]), [
    ["saropaWorkspace.duplicateFile", "files", "Duplicate File…"],
    ["saropaWorkspace.renameFileOnDisk", "replace", "Rename File on Disk…"],
    ["saropaWorkspace.copyFileTo", "file-add", "Copy File To…"],
    ["saropaWorkspace.toggleMask", "eye-closed", "Mask for Screen Sharing"],
  ]);
});

test("a masked shortcut shows Unmask with the open-eye icon", () => {
  const file = buildMenu(shortcut({ masked: true }), "mine", true)[4];
  const last = file.children?.[3];
  assert.deepEqual([last?.command, last?.label, last?.icon], ["saropaWorkspace.toggleMask", "Unmask", "eye"]);
});

test("a recipe gets open, run, Add to Shortcuts and Schedule only", () => {
  const menu = buildMenu(shortcut({ isRecipe: true }), "recipes", true);
  assert.deepEqual(menu.map((m) => [m.command, m.label, m.icon, m.group]), [
    ["saropaWorkspace.openPin", "Open", "go-to-file", "run"],
    ["saropaWorkspace.runPin", "Run", "play", "run"],
    ["saropaWorkspace.promoteRecipe", "Add to Shortcuts", "star-full", "adopt"],
    ["saropaWorkspace.scheduleRecipe", "Schedule…", "clock", "adopt"],
  ]);
});

test("a recipe that is not a file has no Open row", () => {
  const menu = buildMenu(shortcut({ isRecipe: true }), "recipes", false);
  assert.deepEqual(menu.map((m) => m.command), [
    "saropaWorkspace.runPin",
    "saropaWorkspace.promoteRecipe",
    "saropaWorkspace.scheduleRecipe",
  ]);
});

test("a recipe menu never carries a submenu or a dangerous row", () => {
  const menu = buildMenu(shortcut({ isRecipe: true }), "recipes", true);
  assert.equal(menu.some((m) => m.children !== undefined || m.danger === true), false);
});

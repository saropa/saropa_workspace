// Tests for the icon and color picker: the grouped icon list, the two-step flow, the
// rule that clearing the icon clears the color, and persistence for shortcuts and groups.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { configureAppearance, configureGroupAppearance, COLOR_CHOICES } from "../commands/configureAppearance";
import { drivePicks, type PickShowing } from "./uiDrivers";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;

async function stored(name = "a.sh"): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

const iconRows = (shown: PickShowing): string[] => shown.rows.map((r) => r.label);

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-appear-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an auto shortcut cannot be given an icon", async () => {
  await configureAppearance(store, { id: "a", scope: "project", path: "x", order: 0, isAuto: true } as Shortcut);
  assert.deepEqual(__warningMessages(), ["An icon cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
});

test("the icon list starts with the default, then seven titled categories of icons with their synonyms", async () => {
  const s = await stored();
  const shown = drivePicks(undefined);
  await configureAppearance(store, s);
  const rows = shown[0].rows;
  assert.equal(shown[0].options.title, "Icon & Color: a.sh");
  assert.equal(shown[0].options.placeHolder, "Pick an icon by category, or type to search.");
  assert.equal(shown[0].options.matchOnDescription, true);
  assert.equal(rows[0].label, "$(discard) Default file icon");
  const separators = rows.filter((r) => r.kind === -1).map((r) => r.label);
  assert.deepEqual(separators, [
    "Files & code",
    "Run & build",
    "Source control & cloud",
    "Data & terminal",
    "Status & alerts",
    "Shapes & color",
    "Objects & places",
  ]);
  const gear = rows.find((r) => r.label === "$(gear) gear")!;
  assert.equal(gear.value, "gear");
  assert.ok(typeof gear.description === "string" && (gear.description as string).length > 0, "a synonym list is shown");
  assert.equal(new Set(iconRows(shown[0])).size, rows.length, "no icon is listed twice");
});

test("the current icon starts ticked", async () => {
  const s = await stored();
  await store.updateShortcutAppearance(s, "rocket", undefined);
  const shown = drivePicks(undefined);
  await configureAppearance(store, store.findShortcut(s.id)!);
  assert.deepEqual(shown[0].rows.filter((r) => r.picked).map((r) => r.value), ["rocket"]);
});

test("picking an icon then a color stores both and confirms", async () => {
  const s = await stored();
  const shown = drivePicks("$(rocket) rocket", "$(circle-filled) Teal");
  await configureAppearance(store, s);
  const saved = store.findShortcut(s.id)!;
  assert.deepEqual([saved.icon, saved.color], ["rocket", "saropaWorkspace.tint.teal"]);
  assert.deepEqual(__infoMessages(), ["Updated the icon for a.sh."]);
  assert.equal(shown[1].options.placeHolder, "Pick a color for the icon.");
  assert.equal(shown[1].rows[0].label, "$(discard) Default color");
  assert.deepEqual(shown[1].rows.slice(1).map((r) => r.value), COLOR_CHOICES.map((c) => c.id));
});

test("the default color clears the tint but keeps the icon", async () => {
  const s = await stored();
  await store.updateShortcutAppearance(s, "bug", "saropaWorkspace.tint.red");
  drivePicks("$(rocket) rocket", "$(discard) Default color");
  await configureAppearance(store, store.findShortcut(s.id)!);
  const saved = store.findShortcut(s.id)!;
  assert.deepEqual([saved.icon, saved.color], ["rocket", undefined]);
});

test("the current color starts ticked in the color list", async () => {
  const s = await stored();
  await store.updateShortcutAppearance(s, "bug", "saropaWorkspace.tint.blue");
  const shown = drivePicks("$(bug) bug", undefined);
  await configureAppearance(store, store.findShortcut(s.id)!);
  assert.deepEqual(shown[1].rows.filter((r) => r.picked).map((r) => r.value), ["saropaWorkspace.tint.blue"]);
});

test("choosing the default icon clears the color too and skips the color step", async () => {
  const s = await stored();
  await store.updateShortcutAppearance(s, "bug", "saropaWorkspace.tint.red");
  const shown = drivePicks("$(discard) Default file icon");
  await configureAppearance(store, store.findShortcut(s.id)!);
  const saved = store.findShortcut(s.id)!;
  assert.deepEqual([saved.icon, saved.color], [undefined, undefined]);
  assert.equal(shown.length, 1);
});

test("dismissing either step changes nothing", async () => {
  const s = await stored();
  await store.updateShortcutAppearance(s, "bug", "saropaWorkspace.tint.red");
  drivePicks(undefined);
  await configureAppearance(store, store.findShortcut(s.id)!);
  drivePicks("$(rocket) rocket", undefined);
  await configureAppearance(store, store.findShortcut(s.id)!);
  const saved = store.findShortcut(s.id)!;
  assert.deepEqual([saved.icon, saved.color], ["bug", "saropaWorkspace.tint.red"]);
  assert.deepEqual(__infoMessages(), []);
});

test("a group gets its own title and confirmation and is stored on the group", async () => {
  const groupId = (await store.createGroup("project", "Deploys"))!;
  const group = store.getGroups("project").find((g) => g.id === groupId)!;
  const shown = drivePicks("$(cloud) cloud", "$(circle-filled) Cyan");
  await configureGroupAppearance(store, group, "project");
  assert.equal(shown[0].options.title, "Group Icon & Color: Deploys");
  const saved = store.getGroups("project").find((g) => g.id === groupId)!;
  assert.deepEqual([saved.icon, saved.color], ["cloud", "saropaWorkspace.tint.cyan"]);
  assert.deepEqual(__infoMessages(), ["Updated the icon for the Deploys group."]);
});

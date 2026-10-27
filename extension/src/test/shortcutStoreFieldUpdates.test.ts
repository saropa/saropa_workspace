// Tests for the per-field update layer: the fields not covered by the older mutation
// tests (exec, schedule, triggers, appearance, tail, metric, branch, watch globs). Drives a
// real ShortcutStore over the file-backed vscode stub and reads the saved file back.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders, __setConfig, __resetConfig, type WorkspaceFolder } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;
let store: ShortcutStore;

const stored = (path: string): Record<string, unknown> | undefined => {
  const file = JSON.parse(nodeFs.readFileSync(nodePath.join(tmpDir, ".saropa", "saropa-workspace.json"), "utf8"));
  return (file.pins as Array<Record<string, unknown>>).find((p) => p.path === path);
};
const live = (path: string): Shortcut => store.getProjectShortcuts().find((p) => p.path === path && !p.isAuto)!;

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-fields-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
  store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.sh")), "project");
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("run settings are saved, then cleared by passing undefined", async () => {
  await store.updateShortcutExec(live("a.sh"), { args: ["--fast"], cwd: "build" });
  assert.deepEqual(stored("a.sh")?.exec, { args: ["--fast"], cwd: "build" });
  await store.updateShortcutExec(live("a.sh"), undefined);
  assert.equal(stored("a.sh")?.exec, undefined);
});

test("a schedule is saved and cleared", async () => {
  await store.updateShortcutSchedule(live("a.sh"), { cron: "0 9 * * 1-5" } as never);
  assert.deepEqual(stored("a.sh")?.schedule, { cron: "0 9 * * 1-5" });
  await store.updateShortcutSchedule(live("a.sh"), undefined);
  assert.equal(stored("a.sh")?.schedule, undefined);
});

test("empty trigger and emit lists are stored as absent", async () => {
  await store.updateShortcutTriggers(live("a.sh"), [{ kind: "event", event: "build" }] as never, ["publish"]);
  assert.deepEqual(stored("a.sh")?.triggers, [{ kind: "event", event: "build" }]);
  assert.deepEqual(stored("a.sh")?.emits, ["publish"]);
  await store.updateShortcutTriggers(live("a.sh"), [], []);
  assert.equal(stored("a.sh")?.triggers, undefined);
  assert.equal(stored("a.sh")?.emits, undefined);
  await store.updateShortcutTriggers(live("a.sh"), undefined, undefined);
  assert.equal(stored("a.sh")?.triggers, undefined);
});

test("icon and color are saved together and cleared together", async () => {
  await store.updateShortcutAppearance(live("a.sh"), "rocket", "charts.red");
  assert.deepEqual([stored("a.sh")?.icon, stored("a.sh")?.color], ["rocket", "charts.red"]);
  await store.updateShortcutAppearance(live("a.sh"), undefined, undefined);
  assert.deepEqual([stored("a.sh")?.icon, stored("a.sh")?.color], [undefined, undefined]);
});

test("tail-follow is stored only while on", async () => {
  await store.setShortcutTail(live("a.sh"), true);
  assert.equal(stored("a.sh")?.tailFollow, true);
  await store.setShortcutTail(live("a.sh"), false);
  assert.equal("tailFollow" in (stored("a.sh") ?? {}), false);
});

test("a metric is saved and cleared", async () => {
  await store.setShortcutMetric(live("a.sh"), { kind: "size" } as never);
  assert.deepEqual(stored("a.sh")?.metric, { kind: "size" });
  await store.setShortcutMetric(live("a.sh"), undefined);
  assert.equal(stored("a.sh")?.metric, undefined);
});

test("a branch link is stored, and an empty name clears it", async () => {
  await store.setShortcutBranch(live("a.sh"), "feature/x");
  assert.equal(stored("a.sh")?.branch, "feature/x");
  await store.setShortcutBranch(live("a.sh"), "");
  assert.equal(stored("a.sh")?.branch, undefined);
  await store.setShortcutBranch(live("a.sh"), "main");
  await store.setShortcutBranch(live("a.sh"), undefined);
  assert.equal(stored("a.sh")?.branch, undefined);
});

test("watch globs are trimmed, blanks dropped, and created exec settings kept apart from other exec fields", async () => {
  await store.updateShortcutExec(live("a.sh"), { cwd: "build" });
  await store.setShortcutWatchGlobs(live("a.sh"), ["  src/**/*.ts ", "", "   "]);
  assert.deepEqual(stored("a.sh")?.exec, { cwd: "build", runOnSaveGlobs: ["src/**/*.ts"] });
});

test("clearing watch globs on a shortcut with no run settings creates none", async () => {
  await store.setShortcutWatchGlobs(live("a.sh"), []);
  assert.equal(stored("a.sh")?.exec, undefined);
});

test("an update to a shortcut that is not stored changes nothing", async () => {
  const before = nodeFs.readFileSync(nodePath.join(tmpDir, ".saropa", "saropa-workspace.json"), "utf8");
  await store.setShortcutBranch({ id: "ghost", path: "ghost.sh", scope: "project" } as Shortcut, "x");
  assert.equal(nodeFs.readFileSync(nodePath.join(tmpDir, ".saropa", "saropa-workspace.json"), "utf8"), before);
});

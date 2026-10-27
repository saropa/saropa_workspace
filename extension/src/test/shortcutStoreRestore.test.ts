// Tests for the restore layer: re-adding a global or project shortcut, recording a
// scheduled fire, and clearing the removed-recipe list.

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
const fileOf = (): Record<string, unknown> =>
  JSON.parse(nodeFs.readFileSync(nodePath.join(tmpDir, ".saropa", "saropa-workspace.json"), "utf8"));

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-restore-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a removed global shortcut comes back at the end of the global list with its expiry dropped", async () => {
  await store.addShortcut(asUri(Uri.file(`${tmpDir}/first.ts`)), "global");
  const second = { id: "gone", path: "/elsewhere/second.ts", scope: "global", expires: { at: 5 } } as Shortcut;
  await store.restoreShortcut(second);
  const globals = store.getGlobalShortcuts();
  assert.deepEqual(globals.map((g) => g.id).slice(-1), ["gone"]);
  const restored = globals[globals.length - 1];
  assert.equal(restored.order, globals.length - 1);
  assert.equal(restored.expires, undefined);
});

test("a project shortcut restored with no folder goes to the first workspace folder", async () => {
  await store.restoreShortcut({ id: "p1", path: "back.ts", scope: "project" } as Shortcut);
  assert.deepEqual((fileOf().pins as Array<{ id: string; order: number }>).map((p) => [p.id, p.order]), [["p1", 0]]);
});

test("a project shortcut cannot be restored when no folder is open", async () => {
  __setWorkspaceFolders(undefined);
  await store.restoreShortcut({ id: "p2", path: "nowhere.ts", scope: "project" } as Shortcut);
  assert.deepEqual(fileOf().pins, []);
});

test("a scheduled fire records its time, outcome and report path", async () => {
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "job.sh")), "project");
  const job = store.getProjectShortcuts().find((p) => p.path === "job.sh")!;
  await store.updateShortcutSchedule(job, { cron: "0 9 * * *" } as never);
  const scheduled = store.getProjectShortcuts().find((p) => p.path === "job.sh")!;
  await store.updateShortcutScheduleLastRun(scheduled, 1000, { outcome: "failure", reportRelPath: "r/1.md" });
  let sched = (fileOf().pins as Array<{ path: string; schedule: Record<string, unknown> }>).find((p) => p.path === "job.sh")!.schedule;
  assert.deepEqual([sched.lastRun, sched.lastOutcome, sched.lastReportPath], [1000, "failure", "r/1.md"]);
  // A bare time-stamp update keeps the previous outcome; a fresh result without a report clears the old path.
  await store.updateShortcutScheduleLastRun(scheduled, 2000);
  sched = (fileOf().pins as Array<{ path: string; schedule: Record<string, unknown> }>).find((p) => p.path === "job.sh")!.schedule;
  assert.deepEqual([sched.lastRun, sched.lastOutcome, sched.lastReportPath], [2000, "failure", "r/1.md"]);
  await store.updateShortcutScheduleLastRun(scheduled, 3000, { outcome: "success" });
  sched = (fileOf().pins as Array<{ path: string; schedule: Record<string, unknown> }>).find((p) => p.path === "job.sh")!.schedule;
  assert.deepEqual([sched.lastRun, sched.lastOutcome, sched.lastReportPath], [3000, "success", undefined]);
});

test("recording a fire on a shortcut with no schedule changes nothing", async () => {
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "plain.sh")), "project");
  const plain = store.getProjectShortcuts().find((p) => p.path === "plain.sh")!;
  await store.updateShortcutScheduleLastRun(plain, 1000, { outcome: "success" });
  const saved = (fileOf().pins as Array<{ path: string; schedule?: unknown }>).find((p) => p.path === "plain.sh")!;
  assert.equal(saved.schedule, undefined);
});

test("restoring recipes clears the removed list in every folder and reports how many", async () => {
  const file = fileOf();
  file.removedRecipes = ["lint", "test"];
  nodeFs.writeFileSync(nodePath.join(tmpDir, ".saropa", "saropa-workspace.json"), JSON.stringify(file));
  assert.equal(await store.restoreRecipes(), 2);
  assert.deepEqual(fileOf().removedRecipes, []);
  assert.equal(await store.restoreRecipes(), 0);
});

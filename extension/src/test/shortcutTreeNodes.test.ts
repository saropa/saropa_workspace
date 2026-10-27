// Tests for the tree-row builders: how a shortcut's live state (running, last run, missing,
// lock, badges, untapped, owning folder) reaches its row, the Recent entries, the run count
// gate, the lock name, and which shortcuts get a metric watcher.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __fileWatchers, __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle } from "./settle";
import { buildShortcutItem, buildRecentItem, lockedBy, runCount, recentEntries, syncMetrics } from "../views/shortcutTreeNodes";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry } from "../exec/runStatus";
import { shortcutBadges } from "../exec/shortcutBadges";
import { metricBadges } from "../exec/metricBadges";
import { tappedShortcuts } from "../model/tappedShortcuts";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

let shortcuts: Shortcut[];
let missing: Set<string>;
let shadows: Set<string>;
let folderName: string | undefined;

const make = (id: string, over: Partial<Shortcut> = {}): Shortcut =>
  ({ id, path: `src/${id}.ts`, scope: "project", order: 0, ...over }) as Shortcut;
const store = {
  resolveUri: (s: Shortcut) => Uri.file(`/proj/${s.path}`),
  isMissing: (id: string) => missing.has(id),
  shadowsAuto: (id: string) => shadows.has(id),
  folderOf: () => (folderName ? { name: folderName } : undefined),
  findShortcut: (id: string) => shortcuts.find((s) => s.id === id),
  getProjectShortcuts: () => shortcuts.filter((s) => s.scope === "project"),
  getGlobalShortcuts: () => shortcuts.filter((s) => s.scope === "global"),
} as unknown as ShortcutStore;
const folder = (name: string, index: number) => ({ uri: Uri.file(`/${name}`), name, index });

beforeEach(async () => {
  shortcuts = [];
  missing = new Set();
  shadows = new Set();
  folderName = "api";
  __resetConfig();
  __setWorkspaceFolders(undefined);
  telemetry.init(fakeContext());
  await telemetry.reset();
  tappedShortcuts.init(fakeContext());
});

afterEach(() => {
  for (const id of ["a", "b", "dep", "gone"]) {
    runStatusRegistry.clear(id);
    shortcutBadges.clear(id);
  }
  metricBadges.track([]);
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetHosts();
});

test("a row for an idle, tapped shortcut has the resting state", async () => {
  await tappedShortcuts.mark("a");
  const item = buildShortcutItem(store, make("a"));
  assert.equal(item.label, "a.ts");
  assert.equal(item.contextValue, "shortcut");
  assert.equal(item.resourceUri?.fsPath, "/proj/src/a.ts");
});

test("a shortcut that was never opened carries the untapped dot until it is tapped", async () => {
  assert.equal(buildShortcutItem(store, make("a")).label, "● a.ts");
  await tappedShortcuts.mark("a");
  assert.equal(buildShortcutItem(store, make("a")).label, "a.ts");
});

test("the row reads the missing and shadows-auto answers from the store", () => {
  missing.add("a");
  const item = buildShortcutItem(store, make("a"));
  assert.ok((item.accessibilityInformation as { label: string }).label.includes(l10n("a11y.missingState")));
  assert.notEqual(String(buildShortcutItem(store, make("b")).tooltip), String(item.tooltip));
});

test("the row shows the last run outcome as its icon", () => {
  const icon = (id: string): { id: string; color?: { id: string } } =>
    buildShortcutItem(store, make(id)).iconPath as { id: string; color?: { id: string } };
  runStatusRegistry.record("a", { outcome: "failure", at: 1 } as never);
  runStatusRegistry.record("b", { outcome: "success", at: 1 } as never);
  assert.deepEqual([icon("a").id, icon("a").color?.id], ["error", "testing.iconFailed"]);
  assert.deepEqual([icon("b").id, icon("b").color?.id], ["pass", "testing.iconPassed"]);
});

test("a shortcut waiting on an unmet prerequisite shows the lock", () => {
  const dep = make("dep", { label: "Build" });
  const waiting = make("a", { exec: { dependsOn: "dep" } } as never);
  shortcuts = [dep, waiting];
  const item = buildShortcutItem(store, waiting);
  assert.equal((item.accessibilityInformation as { label: string }).label, `a.ts, ${l10n("depends.treeBadge", { dep: "Build" })}`);
});

test("lockedBy names the prerequisite until it has succeeded", () => {
  const waiting = make("a", { exec: { dependsOn: "dep" } } as never);
  shortcuts = [make("dep", { label: "Build" }), waiting];
  assert.equal(lockedBy(store, waiting), "Build");
  runStatusRegistry.record("dep", { outcome: "success", at: 1 } as never);
  assert.equal(lockedBy(store, waiting), undefined);
});

test("lockedBy is empty with no prerequisite and for a prerequisite that was deleted", () => {
  assert.equal(lockedBy(store, make("a")), undefined);
  assert.equal(lockedBy(store, make("a", { exec: { dependsOn: "gone" } } as never)), undefined);
});

test("the owning folder shows only with two or more folders and for project shortcuts", () => {
  const item = (s: Shortcut): string => String(buildShortcutItem(store, s).description);
  const base = item(make("a"));
  __setWorkspaceFolders([folder("api", 0)]);
  assert.equal(item(make("a")), base);
  __setWorkspaceFolders([folder("api", 0), folder("web", 1)]);
  assert.match(item(make("a")), /api/);
  assert.doesNotMatch(item(make("a", { scope: "global" })), /api/);
  folderName = undefined;
  assert.equal(item(make("a")), base);
});

test("the run count follows the telemetry setting", async () => {
  await telemetry.record("a", "manual");
  await telemetry.record("a", "manual");
  assert.equal(runCount("a"), 2);
  assert.equal(runCount("b"), 0);
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  assert.equal(runCount("a"), 0);
});

test("a recent entry is tagged with when and how it last ran", async () => {
  const item = buildRecentItem(store, make("a"), { pinId: "a", at: 5, source: "scheduled", kind: "run" });
  assert.equal(item.isRecent, true);
  assert.equal(item.id, "recent:project:a");
});

test("recent entries skip removed shortcuts and keep most-recent-first order", async () => {
  shortcuts = [make("a"), make("b")];
  await telemetry.record("a", "manual");
  await telemetry.record("gone", "manual");
  await telemetry.record("b", "scheduled");
  const entries = recentEntries(store);
  assert.deepEqual(entries.map((e) => [e.shortcut.id, e.record.source]), [["b", "scheduled"], ["a", "manual"]]);
});

test("recent entries are empty when telemetry is off", async () => {
  shortcuts = [make("a")];
  await telemetry.record("a", "manual");
  __setConfig("saropaWorkspace", "telemetry.enabled", false);
  assert.deepEqual(recentEntries(store), []);
});

test("only file shortcuts with a metric get a watcher, from both scopes", () => {
  const fx: FsFixture = createFsFixture("sw-nodes-");
  try {
    fx.write("src/m1.ts", "x");
    shortcuts = [
      make("m1", { metric: { kind: "size" } } as never),
      make("m2", { scope: "global", metric: { kind: "size" } } as never),
      make("plain"),
      make("sh", { metric: { kind: "size" }, action: { kind: "shell", command: "ls" } } as never),
    ];
    syncMetrics(store);
    assert.equal(__fileWatchers().length, 2);
  } finally {
    fx.remove();
  }
});

test("a shortcut that loses its metric loses its watcher on the next sync", () => {
  shortcuts = [make("m1", { metric: { kind: "size" } } as never)];
  syncMetrics(store);
  const [watcher] = __fileWatchers();
  assert.equal(watcher.disposed, false);
  shortcuts = [make("m1")];
  syncMetrics(store);
  assert.equal(watcher.disposed, true);
});

test("a metric badge reaches the row once the file is measured", async () => {
  const fx: FsFixture = createFsFixture("sw-nodes-");
  try {
    nodeFs.mkdirSync(`${fx.dir}/src`);
    nodeFs.writeFileSync(`${fx.dir}/src/m1.ts`, Buffer.alloc(2048));
    const local = { ...store, resolveUri: (s: Shortcut) => Uri.file(`${fx.dir}/${s.path}`) } as unknown as ShortcutStore;
    shortcuts = [make("m1", { metric: { kind: "size" } } as never)];
    syncMetrics(local);
    await settle(() => metricBadges.get("m1") !== undefined);
    assert.equal(metricBadges.get("m1")?.text, "2.0 KB");
    assert.match(String(buildShortcutItem(local, shortcuts[0]).description), /2\.0 KB/);
  } finally {
    fx.remove();
  }
});

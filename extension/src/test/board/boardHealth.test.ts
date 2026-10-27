// Code health host side: which shortcut a project names, how the stored run records are
// read, and how a record counts as evidence only while its shortcut is still named.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { HealthFile } from "../../board/health";
import { BoardConfig, ProjectDef } from "../../board/types";
import { Shortcut } from "../../model/shortcut";
import { ShortcutStore } from "../../model/shortcutStore";
import { collectHealth, findHealthShortcut, matches, readHealthFile } from "../../commands/boardHealth";
import { contextIn, tmpDir } from "./hostHelpers";

function shortcut(id: string, label: string, scope: "project" | "global" = "project"): Shortcut {
  return { id, path: `${label}.sh`, label, scope } as Shortcut;
}

function storeOf(...list: Shortcut[]): ShortcutStore {
  return {
    getProjectShortcuts: () => list.filter((s) => s.scope === "project"),
    getGlobalShortcuts: () => list.filter((s) => s.scope === "global"),
    findShortcut: (id: string) => list.find((s) => s.id === id),
  } as unknown as ShortcutStore;
}

function project(health: ProjectDef["health"]): ProjectDef {
  return { id: "app", path: "/work/app", roots: [], ruleSets: [], health };
}

test("a project names its test or lint run by id or by name", () => {
  const store = storeOf(shortcut("a1", "Run tests"), shortcut("b2", "Lint all"));
  assert.equal(findHealthShortcut(store, project({ tests: ["a1"] }), "tests")?.id, "a1");
  assert.equal(findHealthShortcut(store, project({ lint: ["lint all"] }), "lint")?.id, "b2");
});

test("a project that names nothing has no shortcut", () => {
  const store = storeOf(shortcut("a1", "Run tests"));
  assert.equal(findHealthShortcut(store, project(undefined), "tests"), undefined);
  assert.equal(findHealthShortcut(store, project({ tests: [] }), "tests"), undefined);
  assert.equal(findHealthShortcut(store, project({ tests: ["zzz"] }), "tests"), undefined);
});

test("a name carried by two shortcuts matches neither, but an id still does", () => {
  const store = storeOf(shortcut("a1", "Run tests"), shortcut("a2", "Run tests", "global"));
  assert.equal(findHealthShortcut(store, project({ tests: ["Run tests"] }), "tests"), undefined);
  assert.equal(findHealthShortcut(store, project({ tests: ["a2"] }), "tests")?.id, "a2");
});

test("matches compares names without case", () => {
  const counts = new Map([["run tests", 1]]);
  assert.equal(matches(["RUN TESTS"], "x", "Run tests", counts), true);
  assert.equal(matches(undefined, "x", "Run tests", counts), false);
});

test("a missing or damaged health file reads as empty", async () => {
  const dir = tmpDir();
  const ctx = contextIn(dir);
  assert.deepEqual(await readHealthFile(ctx.storageUri!), { version: 1, projects: {}, seen: {} });
  fs.writeFileSync(path.join(dir, "release-board-health.json"), "{ not json");
  assert.deepEqual(await readHealthFile(ctx.storageUri!), { version: 1, projects: {}, seen: {} });
  fs.writeFileSync(path.join(dir, "release-board-health.json"), JSON.stringify({ version: 2, projects: { x: {} } }));
  assert.deepEqual(await readHealthFile(ctx.storageUri!), { version: 1, projects: {}, seen: {} });
});

test("a recorded run is evidence only while its shortcut is still the one the project names", async () => {
  const dir = tmpDir();
  const ctx = contextIn(dir);
  const now = Date.now();
  const file: HealthFile = {
    version: 1,
    seen: {},
    projects: { app: { tests: { pinId: "a1", name: "Run tests", outcome: "success", exitCode: 0, endedAt: now - 1000, run: 10, failed: 0 } } },
  };
  fs.writeFileSync(path.join(dir, "release-board-health.json"), JSON.stringify(file));
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ ...project({ tests: ["a1"], lintApplies: false }), path: "file:///nowhere" }] };
  const named = await collectHealth(ctx, storeOf(shortcut("a1", "Run tests")), cfg, now);
  assert.equal(named.app.tests, "passing");
  // The shortcut was renamed away from what the project names: the record no longer counts.
  const other: BoardConfig = { ...cfg, projects: [{ ...cfg.projects[0], health: { tests: ["zzz"], lintApplies: false } }] };
  assert.equal((await collectHealth(ctx, storeOf(shortcut("a1", "Run tests")), other, now)).app.tests, "missing");
  // The shortcut is deleted: no evidence either.
  assert.equal((await collectHealth(ctx, storeOf(), cfg, now)).app.tests, "missing");
});

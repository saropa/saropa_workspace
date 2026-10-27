// The host side of In progress: the settings and the names of the documents being edited.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { BoardConfig } from "../../board/types";
import { EditedDeps, collectEdited, readInProgressSettings, resetEditedCache } from "../../commands/boardInProgress";
import { stub } from "./hostHelpers";

afterEach(() => {
  stub.__resetConfig();
  resetEditedCache();
});

const cfg = (...projects: Array<[string, string]>): BoardConfig => ({
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: projects.map(([id, dir]) => ({ id, path: vscode.Uri.file(dir).toString(), roots: [], ruleSets: [] })),
});

const doc = (fsPath: string, isDirty = false, scheme = "file") => ({ isDirty, uri: Object.assign(vscode.Uri.file(fsPath), { scheme }) });

function deps(docs: ReturnType<typeof doc>[], gitOutput: Record<string, string[]> = {}, calls: Array<[string, string[]]> = []): EditedDeps {
  return {
    docs: () => docs,
    changed: async (root, rels) => (calls.push([root, rels]), gitOutput[root] ?? []),
    ignoreCase: false,
  };
}

test("the settings default to on with a limit of 15, and a bad limit falls back inside its bounds", () => {
  assert.deepEqual(readInProgressSettings(), { enabled: true, max: 15 });
  stub.__setConfig("saropaWorkspace.releaseBoard.inProgress", "max", 500);
  assert.equal(readInProgressSettings().max, 50);
  stub.__setConfig("saropaWorkspace.releaseBoard.inProgress", "max", 0);
  assert.equal(readInProgressSettings().max, 1);
  stub.__setConfig("saropaWorkspace.releaseBoard.inProgress", "max", "many");
  assert.equal(readInProgressSettings().max, 15);
  stub.__setConfig("saropaWorkspace.releaseBoard.inProgress", "enabled", false);
  assert.equal(readInProgressSettings().enabled, false);
});

test("a dirty document is edited, and a clean one counts only when git says it changed", async () => {
  const calls: Array<[string, string[]]> = [];
  const d = deps([doc("/w/app/docs/dirty.md", true), doc("/w/app/docs/changed.md"), doc("/w/app/docs/same.md")], { "/w/app": ["docs/changed.md"] }, calls);
  assert.deepEqual((await collectEdited(cfg(["app", "/w/app"]), d, 1000)).sort(), ["app/docs/changed.md", "app/docs/dirty.md"]);
  assert.deepEqual(calls, [["/w/app", ["docs/changed.md", "docs/same.md"]]], "git is asked once, about the clean documents only");
});

test("documents outside every project, and documents that are not files, are ignored", async () => {
  const calls: Array<[string, string[]]> = [];
  const d = deps([doc("/elsewhere/a.md", true), doc("/w/app/x.md", true, "untitled"), doc("/w/app/y.md", true, "output")], {}, calls);
  assert.deepEqual(await collectEdited(cfg(["app", "/w/app"]), d, 1000), []);
  assert.deepEqual(calls, [], "git is not asked when no open document is inside a project");
});

test("two projects are told apart and each is asked about its own documents", async () => {
  const calls: Array<[string, string[]]> = [];
  const d = deps([doc("/w/app/docs/a.md"), doc("/w/db/docs/a.md")], { "/w/db": ["docs/a.md"] }, calls);
  assert.deepEqual(await collectEdited(cfg(["app", "/w/app"], ["db", "/w/db"]), d, 1000), ["db/docs/a.md"]);
  assert.deepEqual(calls.map((c) => c[0]), ["/w/app", "/w/db"]);
});

test("git is asked at most once in a few seconds for the same documents", async () => {
  const calls: Array<[string, string[]]> = [];
  const d = deps([doc("/w/app/docs/a.md")], { "/w/app": ["docs/a.md"] }, calls);
  const c = cfg(["app", "/w/app"]);
  assert.deepEqual(await collectEdited(c, d, 1000), ["app/docs/a.md"]);
  assert.deepEqual(await collectEdited(c, d, 2000), ["app/docs/a.md"]);
  assert.equal(calls.length, 1);
  await collectEdited(c, d, 1000 + 4001);
  assert.equal(calls.length, 2);
});

test("at most 100 open documents of a project are looked at", async () => {
  const calls: Array<[string, string[]]> = [];
  const many = Array.from({ length: 150 }, (_x, i) => doc(`/w/app/docs/${i}.md`));
  await collectEdited(cfg(["app", "/w/app"]), deps(many, {}, calls), 1000);
  assert.equal(calls[0][1].length, 100);
});

// Release train host side: the settings and the cases where no train is shown.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BoardModel } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";
import { folderOf, readTrainSettings, trainsFor } from "../../views/boardTrain";
import { stub } from "./hostHelpers";

const SECTION = "saropaWorkspace.releaseBoard.train";

afterEach(() => stub.__resetConfig());

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", path: "file:///work/app", roots: [], ruleSets: [] }] };

test("the train is on by default and named by version", () => {
  assert.deepEqual(readTrainSettings(), { naming: "version" });
});

test("it can be switched off, and an unknown naming falls back", () => {
  stub.__setConfig(SECTION, "naming", "folder");
  assert.deepEqual(readTrainSettings(), { naming: "folder" });
  stub.__setConfig(SECTION, "naming", "odd");
  assert.deepEqual(readTrainSettings(), { naming: "version" });
  stub.__setConfig(SECTION, "enabled", false);
  assert.equal(readTrainSettings(), undefined);
});

test("a train needs two projects, and none shows while it is off", () => {
  const one = { projects: [{ id: "app", name: "App", light: "go", dependsOn: [] }] } as unknown as BoardModel;
  assert.deepEqual(trainsFor(one, cfg), []);
  stub.__setConfig(SECTION, "enabled", false);
  const two = { projects: [...one.projects, { id: "web", name: "Web", light: "go", dependsOn: [] }] } as unknown as BoardModel;
  assert.deepEqual(trainsFor(two, cfg), []);
});

test("a project is named after the last folder of its path", () => {
  assert.equal(folderOf("file:///work/app"), "app");
  assert.equal(folderOf("file:///work/app/"), "app");
});

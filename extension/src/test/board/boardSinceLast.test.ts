// Since-last host side: the time text, the settings gates, and the first board being
// recorded silently so the next change is measured against it.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BoardItem, BoardModel, BoardProject } from "../../board/boardModel";
import { emptyCounts } from "../../board/types";
import { currentChange, markSeenNow, maxListed, registerSinceLast, sidebarLines, viewFor, whenText } from "../../views/boardSinceLast";
import { setBoard } from "../../views/boardFeed";
import type { BoardRun } from "../../commands/boardScanStore";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => stub.__resetConfig());

function item(title: string): BoardItem {
  return { id: 0, project: "app", path: `bugs/${title}.md`, title, status: "red", kind: "", hub: false, waitsOn: [], blocksCount: 0, pinned: false, stopping: true };
}

function model(...titles: string[]): BoardModel {
  const p: BoardProject = { id: "app", name: "App", light: "no-go", reasons: [], items: titles.map(item), blocked: 0, blockedStopping: 0, counts: emptyCounts(), dependsOn: [] };
  return { projects: [p] } as unknown as BoardModel;
}

test("a recent look shows the weekday and time, an old one the date with its year", () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  assert.ok(!whenText(now - 3600_000, now).includes("2026"));
  assert.ok(whenText(Date.UTC(2020, 0, 5, 9, 30), now).includes("2020"));
});

test("the number of listed changes is clamped", () => {
  assert.equal(maxListed(), 5);
  stub.__setConfig("saropaWorkspace.releaseBoard", "sinceLast.maxListed", 500);
  assert.equal(maxListed(), 20);
  stub.__setConfig("saropaWorkspace.releaseBoard", "sinceLast.maxListed", 0);
  assert.equal(maxListed(), 1);
});

test("with the setting off there is no change and no strip", () => {
  stub.__setConfig("saropaWorkspace.releaseBoard", "sinceLast.enabled", false);
  setBoard(model("A"), {} as BoardRun);
  assert.equal(currentChange(), undefined);
  assert.equal(viewFor(model("A")), undefined);
});

test("the first board is recorded silently, then a changed board shows what is new until it is marked seen", () => {
  const ctx = contextIn(tmpDir());
  setBoard(undefined, undefined);
  registerSinceLast(ctx);
  setBoard(model("A"), {} as BoardRun);
  assert.equal(currentChange(), undefined);
  setBoard(model("A", "B"), {} as BoardRun);
  const change = currentChange();
  assert.deepEqual(change?.changes[0].added, ["B"]);
  assert.ok(sidebarLines(change!).length > 0);
  assert.ok(viewFor(model("A", "B")));
  markSeenNow();
  assert.equal(currentChange(), undefined);
  ctx.subscriptions.forEach((d) => d.dispose());
});

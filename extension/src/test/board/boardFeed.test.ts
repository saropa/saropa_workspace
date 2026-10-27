// The published-board feed: state flags, change events and the stale note.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardModel } from "../../board/boardModel";
import {
  askRefresh, currentBoard, hasFailed, hasPanelOpened, isFirstScanDone, isPanelVisible, isScanning, isStoredOnly,
  markPanelOpened, markScanDone, onDidAskRefresh, onDidChangeBoard, onDidChangePanelVisible, setBoard, setFailed, setPanelVisible, setScanning, staleNote,
} from "../../views/boardFeed";
import type { BoardRun } from "../../commands/boardScanStore";

const model = { projects: [] } as unknown as BoardModel;
const run = {} as BoardRun;

test("publishing a board stamps it and tells listeners", () => {
  let fired = 0;
  const sub = onDidChangeBoard(() => (fired += 1));
  setBoard(model, run);
  const first = currentBoard();
  setBoard(model, run);
  assert.ok(first && currentBoard() && currentBoard()!.stamp > first.stamp);
  assert.equal(fired, 2);
  sub.dispose();
});

test("a stored result is marked, and a fresh one clears an earlier failure", () => {
  setFailed(true);
  setBoard(model, run, true);
  assert.equal(isStoredOnly(), true);
  assert.equal(hasFailed(), true);
  setBoard(model, run);
  assert.equal(isStoredOnly(), false);
  assert.equal(hasFailed(), false);
});

test("publishing nothing clears the board", () => {
  setBoard(model, run);
  setBoard(undefined, undefined);
  assert.equal(currentBoard(), undefined);
  assert.equal(isStoredOnly(), false);
});

test("the stale note names a failure first, then a stored result, else nothing", () => {
  setBoard(undefined, undefined);
  setFailed(false);
  assert.equal(staleNote(), undefined);
  setBoard(model, run, true);
  setScanning(false);
  const stored = staleNote();
  assert.ok(stored);
  setScanning(true);
  const updating = staleNote();
  assert.ok(updating && updating !== stored);
  setFailed(true);
  const failed = staleNote();
  assert.ok(failed && failed !== stored && failed !== updating);
  setFailed(false);
  setScanning(false);
});

test("the first scan to end completes the loading state", () => {
  setScanning(true);
  assert.equal(isScanning(), true);
  setScanning(false);
  assert.equal(isScanning(), false);
  assert.equal(isFirstScanDone(), true);
  markScanDone();
  assert.equal(isFirstScanDone(), true);
});

test("setFailed only fires on a change", () => {
  setFailed(false);
  let fired = 0;
  const sub = onDidChangeBoard(() => (fired += 1));
  setFailed(false);
  setFailed(true);
  setFailed(true);
  assert.equal(fired, 1);
  setFailed(false);
  sub.dispose();
});

test("panel visibility fires once per change and remembers a tab was opened", () => {
  const seen: boolean[] = [];
  const sub = onDidChangePanelVisible((v) => seen.push(v));
  setPanelVisible(true);
  setPanelVisible(true);
  setPanelVisible(false);
  assert.deepEqual(seen, [true, false]);
  assert.equal(isPanelVisible(), false);
  assert.equal(hasPanelOpened(), true);
  markPanelOpened();
  sub.dispose();
});

test("a refresh request reaches the listener", () => {
  let asked = 0;
  const sub = onDidAskRefresh(() => (asked += 1));
  askRefresh();
  assert.equal(asked, 1);
  sub.dispose();
});

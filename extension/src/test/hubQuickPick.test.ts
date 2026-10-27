import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __quickPicks, __resetHosts } from "./_stub/vscode";
import { showHubQuickPick } from "../commands/hubQuickPick";

const A = { label: "A" };
const B = { label: "B" };

beforeEach(() => __resetHosts());

test("the menu is built with its title, placeholder and rows, kept open on focus loss, and shown", () => {
  void showHubQuickPick([A, B], { title: "T", placeholder: "P" });
  const [qp] = __quickPicks();
  assert.equal(qp.title, "T");
  assert.equal(qp.placeholder, "P");
  assert.deepEqual(qp.items, [A, B]);
  assert.equal(qp.ignoreFocusOut, true);
  assert.equal(qp.shown, true);
  assert.deepEqual(qp.activeItems, []);
});

test("the row the caller last acted on starts active", () => {
  void showHubQuickPick([A, B], { title: "T", placeholder: "P", active: B });
  assert.deepEqual(__quickPicks()[0].activeItems, [B]);
});

test("accepting a row resolves with it and then disposes the menu", async () => {
  const result = showHubQuickPick([A, B], { title: "T", placeholder: "P" });
  const [qp] = __quickPicks();
  qp.accept(B);
  assert.equal(await result, B);
  assert.equal(qp.shown, false);
  assert.equal(qp.disposed, true);
});

test("hiding without an accept resolves undefined and disposes the menu", async () => {
  const result = showHubQuickPick([A], { title: "T", placeholder: "P" });
  const [qp] = __quickPicks();
  qp.hide();
  assert.equal(await result, undefined);
  assert.equal(qp.disposed, true);
});

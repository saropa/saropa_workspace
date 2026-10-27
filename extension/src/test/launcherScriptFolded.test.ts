// Tests for the Launcher webview's pane heads and per-pane sorting.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "./_stub/fakeDom";
import { openWith, ITEMS, cardNames, lastState, head } from "./launcherWebviewFixture";

test("the pane head cycles grouped, A to Z, Z to A and back, keeping focus on the head", () => {
  const page = openWith(ITEMS);
  const head = (): ReturnType<Page["one"]> => page.one('[data-pane="mine"] .pane-head');
  assert.equal(head().querySelector(".pane-sort-label")!.textContent, "Grouped");
  page.click(head());
  assert.deepEqual(cardNames(page, '[data-pane="mine"]'), ["Build app", "Build docs", "Deploy"]);
  assert.equal(page.all('[data-pane="mine"] .group').length, 0);
  assert.equal(head().querySelector(".pane-sort-label")!.textContent, "A to Z");
  assert.deepEqual(lastState(page).sort, { mine: "asc" });
  page.frames.flush();
  assert.equal(page.document.activeElement, head());
  page.click(head());
  assert.deepEqual(cardNames(page, '[data-pane="mine"]'), ["Deploy", "Build docs", "Build app"]);
  assert.equal(head().title, "Z to A");
  page.click(head());
  assert.equal(page.all('[data-pane="mine"] .group').length, 2);
  assert.deepEqual(lastState(page).sort, {});
});

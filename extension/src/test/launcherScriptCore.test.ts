// Tests for the Launcher webview's shared state: the header, the project name and the saved category.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dataMessage, open, openWith, ITEMS, CATEGORIES, cardNames, lastState, visiblePanes } from "./launcherWebviewFixture";

test("a data message paints the header: project, version and stats", () => {
  const page = openWith([], { header: { project: "My App", version: "1.2.3", stats: [{ icon: "clock", text: "2 rituals" }], noProject: false }, placeholder: "Search shortcuts" });
  assert.equal(page.byId("projName").textContent, "My App");
  assert.deepEqual(page.all("#projMeta .meta-item").map((e) => `${e.className}|${e.textContent}`), ["meta-item version|1.2.3", "meta-item|2 rituals"]);
  assert.equal(page.byId("q").placeholder, "Search shortcuts");
});

test("clicking the project name opens a folder only while no project is open", () => {
  const page = openWith([], { header: { project: "No folder", stats: [], noProject: true } });
  page.click(page.byId("projName"));
  assert.deepEqual(page.takePosted(), [{ type: "openFolder" }]);
  page.receive(dataMessage([], { header: { project: "My App", stats: [], noProject: false } }));
  page.click(page.byId("projName"));
  assert.deepEqual(page.takePosted(), []);
});

test("a saved category that no longer exists heals to All on load", () => {
  const page = open({ state: { collapsed: {}, category: "ghost" } });
  page.receive(dataMessage(ITEMS, { categories: CATEGORIES }));
  assert.deepEqual(lastState(page), { collapsed: {} });
  assert.equal(cardNames(page).length, 5);
});

test("a saved category is restored on load", () => {
  const page = open({ state: { collapsed: {}, category: "mine" } });
  page.receive(dataMessage(ITEMS, { categories: CATEGORIES }));
  assert.deepEqual(visiblePanes(page), ["mine"]);
  assert.equal(page.one('.cat-item[data-category="mine"]').getAttribute("aria-current"), "true");
});

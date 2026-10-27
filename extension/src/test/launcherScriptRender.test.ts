// Tests for the Launcher webview's rendering: panes, groups, search, the category list and run history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dataMessage, item, open, openWith, EVIL, ITEMS, CATEGORIES, cardNames, lastState, visiblePanes } from "./launcherWebviewFixture";

test("items are filed into the fixed pane order, with groups, counts and an item total", () => {
  const page = openWith(ITEMS);
  assert.deepEqual(page.all(".pane").map((p) => p.dataset.pane), ["mine", "recipes", "watches", "files", "scripts", "notes", "mobileRemote"]);
  assert.deepEqual(visiblePanes(page), ["mine", "watches", "files"]);
  assert.deepEqual(page.all('[data-pane="mine"] .group').map((g) => `${g.dataset.groupId}:${g.querySelector(".group-label")!.textContent}:${g.querySelector(".group-count")!.textContent}`), ["g1:Daily:2", "g2:Weekly:1"]);
  assert.deepEqual(page.all(".pane:not(.hidden) .pane-head").map((h) => `${h.querySelector(".pane-title")!.textContent}:${h.querySelector(".pane-count")!.textContent}`), ["My shortcuts:3", "Watches:1", "Project files:1"]);
  assert.equal(page.byId("count").textContent, "5 items");
  assert.equal(page.byId("empty").classList.contains("hidden"), true);
});

test("with no items at all the empty message is shown", () => {
  const page = openWith([]);
  assert.equal(page.byId("empty").classList.contains("hidden"), false);
  assert.equal(page.byId("count").textContent, "0 items");
});

test("host text is written as text, never as markup", () => {
  const page = openWith(
    [item({ id: "a", label: EVIL, sub: EVIL + "!", desc: EVIL, section: EVIL })],
    { categories: [{ id: "all", label: EVIL, count: 1, icon: "x" }], runHistory: [{ id: "adb:x", label: EVIL, count: 2 }], header: { project: EVIL, version: EVIL, stats: [{ icon: "x", text: EVIL }] } },
  );
  assert.equal(page.all("img").length, 0);
  assert.equal(page.one(".card-name").textContent, EVIL);
  assert.equal(page.one(".card-sub").textContent, EVIL + "!");
  assert.equal(page.one(".drawer-desc").textContent, EVIL);
  assert.equal(page.one(".group-label").textContent, EVIL);
  assert.equal(page.one(".cat-label").textContent, EVIL);
  assert.equal(page.one(".run-history-label").textContent, EVIL);
  assert.equal(page.byId("projName").textContent, EVIL);
  assert.equal(page.one(".card").dataset.hay, `${EVIL} ${EVIL}! ${EVIL} ${EVIL}`.toLowerCase());
});

test("typing filters cards by label, sub, description and section, hiding emptied groups and panes", () => {
  const page = openWith(ITEMS);
  page.type(page.byId("q"), "  BUILD ");
  assert.deepEqual(cardNames(page), ["Build app", "Build docs"]);
  assert.deepEqual(page.all(".group:not(.hidden)").map((g) => g.dataset.groupId), ["g1"]);
  assert.deepEqual(visiblePanes(page), ["mine"]);
  assert.equal(page.byId("count").textContent, "2 of 5");
  assert.equal(page.byId("root").classList.contains("searching"), true);
  page.type(page.byId("q"), "weekly");
  assert.deepEqual(cardNames(page), ["Deploy"]);
  page.type(page.byId("q"), "npm run");
  assert.deepEqual(cardNames(page), ["Build app"]);
  page.type(page.byId("q"), "");
  assert.equal(cardNames(page).length, 5);
  assert.equal(page.byId("count").textContent, "5 items");
  assert.equal(page.byId("root").classList.contains("searching"), false);
});

test("a search that matches nothing hides every pane and shows 0 of the total", () => {
  const page = openWith(ITEMS);
  page.type(page.byId("q"), "zzz");
  assert.deepEqual(visiblePanes(page), []);
  assert.equal(page.byId("count").textContent, "0 of 5");
});

test("the category list marks the selected row and filters the panes when another is picked", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  assert.deepEqual(page.all(".cat-item").map((r) => `${r.dataset.category}:${r.querySelector(".cat-count")!.textContent}:${r.getAttribute("aria-current")}`), ["all:5:true", "mine:3:false", "recipes:0:false"]);
  page.click(page.one('.cat-item[data-category="mine"]'));
  assert.deepEqual(visiblePanes(page), ["mine"]);
  assert.equal(page.byId("count").textContent, "3 items");
  assert.deepEqual(page.all(".cat-item").map((r) => r.getAttribute("aria-current")), ["false", "true", "false"]);
  assert.deepEqual(lastState(page), { collapsed: {}, category: "mine" });
});

test("picking a category ends an active search, and picking the same one again does nothing", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  page.type(page.byId("q"), "deploy");
  page.click(page.one('.cat-item[data-category="mine"]'));
  assert.equal(page.byId("q").value, "");
  assert.equal(cardNames(page).length, 3);
  const saves = page.states.length;
  page.click(page.one('.cat-item[data-category="mine"]'));
  assert.equal(page.states.length, saves);
});

test("picking All clears the saved category", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  page.click(page.one('.cat-item[data-category="mine"]'));
  page.click(page.one('.cat-item[data-category="all"]'));
  assert.deepEqual(lastState(page), { collapsed: {} });
  assert.equal(cardNames(page).length, 5);
});

test("typing while a category is selected returns to All and applies the search", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  page.click(page.one('.cat-item[data-category="mine"]'));
  page.type(page.byId("q"), "deploy");
  assert.deepEqual(lastState(page), { collapsed: {} });
  assert.deepEqual(cardNames(page), ["Deploy"]);
  assert.equal(page.byId("count").textContent, "1 of 5");
  assert.deepEqual(page.all(".cat-item").map((r) => r.getAttribute("aria-current")), ["true", "false", "false"]);
});

test("a category with no items falls back to All instead of leaving a blank center", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  page.click(page.one('.cat-item[data-category="recipes"]'));
  assert.deepEqual(lastState(page), { collapsed: {} });
  assert.deepEqual(visiblePanes(page), ["mine", "watches", "files"]);
});

test("clicking a group head folds it and saves the fold; a rebuild keeps it", () => {
  const page = openWith(ITEMS);
  page.click(page.one('.group[data-group-id="g1"] .group-head'));
  assert.equal(page.one('.group[data-group-id="g1"]').classList.contains("collapsed"), true);
  assert.deepEqual(lastState(page), { collapsed: { g1: true } });
  page.receive(dataMessage(ITEMS));
  assert.equal(page.one('.group[data-group-id="g1"]').classList.contains("collapsed"), true);
  page.click(page.one('.group[data-group-id="g1"] .group-head'));
  assert.deepEqual(lastState(page), { collapsed: {} });
});

test("folds saved earlier are applied when the page loads", () => {
  const page = open({ state: { collapsed: { g2: true } } });
  page.receive(dataMessage(ITEMS));
  assert.deepEqual(page.all(".group.collapsed").map((g) => g.dataset.groupId), ["g2"]);
});

test("run history rows show the label and count and run again with the history id", () => {
  const page = openWith([], { runHistory: [{ id: "adb:reboot", label: "Reboot", count: 3 }, { id: "adb:logcat", label: "Logcat", count: 1 }] });
  assert.deepEqual(page.all(".run-history-item").map((r) => `${r.querySelector(".run-history-label")!.textContent}:${r.querySelector(".run-history-count")!.textContent}:${r.querySelector(".run-history-count")!.getAttribute("aria-label")}`), ["Reboot:3:3 runs", "Logcat:1:1 runs"]);
  page.click(page.all(".run-history-run")[1]);
  assert.deepEqual(page.takePosted(), [{ type: "run", id: "adb:logcat" }]);
});

test("an empty run history says why: nothing run yet, or history turned off", () => {
  const page = openWith([]);
  assert.equal(page.one(".run-history-empty").textContent, "Nothing run yet");
  page.receive(dataMessage([], { runHistoryEnabled: false }));
  assert.equal(page.one(".run-history-empty").textContent, "History is off");
});

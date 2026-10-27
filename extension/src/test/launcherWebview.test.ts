// Behavior tests for the Launcher webview: the real shell and script run together in the
// fake DOM, driven by host messages, typing and clicks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LEFT_PANEL_LIMITS } from "../views/launcher/launcherSplitLogic";
import type { Page } from "./_stub/fakeDom";
import { dataMessage, item, open, openWith } from "./launcherWebviewFixture";

const EVIL = '<img src=x onerror="alert(1)">&"\'';

const ITEMS = [
  item({ id: "a", label: "Build app", sub: "npm run build", groupId: "g1", section: "Daily" }),
  item({ id: "b", label: "Build docs", groupId: "g1", section: "Daily" }),
  item({ id: "c", label: "Deploy", groupId: "g2", section: "Weekly" }),
  item({ id: "w1", label: "Watch logs", pane: "watches", groupId: "watches", section: "Watches" }),
  item({ id: "/p/pubspec.yaml", label: "pubspec.yaml", pane: "files", groupId: "proj", section: "Project" }),
];
const CATEGORIES = [
  { id: "all", label: "All", count: 5, icon: "list-flat" },
  { id: "mine", label: "My shortcuts", count: 3, icon: "star-full" },
  { id: "recipes", label: "Recipes", count: 0, icon: "lightbulb" },
];

const cardNames = (page: Page, scope = ""): string[] =>
  page.all(`${scope} .card:not(.hidden) .card-name`.trim()).map((e) => e.textContent);
const lastState = (page: Page): Record<string, unknown> => page.states[page.states.length - 1] as Record<string, unknown>;
const visiblePanes = (page: Page): string[] => page.all(".pane:not(.hidden)").map((p) => p.dataset.pane!);

test("loading reports the right panel as hidden, then ready, and sizes the left panel to its default", () => {
  const page = open();
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: false }, { type: "ready" }]);
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), true);
  assert.equal(page.byId("leftPanel").classList.contains("hidden"), false);
  assert.equal(page.document.documentElement.style.getPropertyValue("--launcher-left-w"), `${LEFT_PANEL_LIMITS.defaultWidth}px`);
});

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

test("items are filed into the fixed pane order, with groups, counts and an item total", () => {
  const page = openWith(ITEMS);
  assert.deepEqual(page.all(".pane").map((p) => p.dataset.pane), ["mine", "recipes", "watches", "files", "scripts", "notes", "mobileRemote"]);
  assert.deepEqual(visiblePanes(page), ["mine", "watches", "files"]);
  assert.deepEqual(page.all('[data-pane="mine"] .group').map((g) => `${g.dataset.groupId}:${g.querySelector(".group-label")!.textContent}:${g.querySelector(".group-count")!.textContent}`), ["g1:Daily:2", "g2:Weekly:1"]);
  assert.deepEqual(page.all(".pane:not(.hidden) .pane-head").map((h) => `${h.querySelector(".pane-title")!.textContent}:${h.querySelector(".pane-count")!.textContent}`), ["My shortcuts:3", "Watches:1", "Project files:1"]);
  assert.equal(page.byId("count").textContent, "5 items");
  assert.equal(page.byId("empty").classList.contains("hidden"), true);
});

test("a card shows its label and a sub line only when it differs from the label", () => {
  const page = openWith([item({ id: "x", label: "Same", sub: "Same" }), item({ id: "y", label: "Other", sub: "detail" })]);
  assert.deepEqual(page.all(".card").map((c) => c.querySelectorAll(".card-sub").map((s) => s.textContent)), [[], ["detail"]]);
});

test("with no items at all the empty message is shown", () => {
  const page = openWith([]);
  assert.equal(page.byId("empty").classList.contains("hidden"), false);
  assert.equal(page.byId("count").textContent, "0 items");
});

test("card tints use the theme variable with the host's hex fallback", () => {
  const page = openWith(
    [item({ id: "a", label: "A", color: "charts.blue" }), item({ id: "b", label: "B", color: "charts.red" }), item({ id: "c", label: "C", color: "" })],
    { tintHexes: { "charts.blue": "#3794ff" } },
  );
  assert.deepEqual(page.all(".card").map((c) => c.style.getPropertyValue("--card-tint")), ["var(--vscode-charts-blue, #3794ff)", "var(--vscode-charts-red)", "var(--vscode-foreground)"]);
  assert.equal((page.one(".group-glyph").style as unknown as Record<string, string>).color, "var(--vscode-charts-blue)");
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

test("the cycleSort message sorts every pane, or only the selected category", () => {
  const page = openWith(ITEMS, { categories: CATEGORIES });
  page.receive({ type: "cycleSort" });
  assert.deepEqual(lastState(page).sort, { mine: "asc", recipes: "asc", watches: "asc", files: "asc", scripts: "asc", notes: "asc", mobileRemote: "asc" });
  page.receive({ type: "cycleSort" });
  page.receive({ type: "cycleSort" });
  assert.deepEqual(lastState(page).sort, {});
  page.click(page.one('.cat-item[data-category="mine"]'));
  page.receive({ type: "cycleSort" });
  assert.deepEqual(lastState(page).sort, { mine: "asc" });
});

test("the toggleRightPanel message shows and hides the right panel and tells the host", () => {
  const page = openWith(ITEMS);
  page.receive({ type: "toggleRightPanel" });
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), false);
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: true }]);
  assert.deepEqual((lastState(page).panels as Record<string, unknown>).right, { hidden: false });
  page.receive({ type: "toggleRightPanel" });
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), true);
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: false }]);
});

test("a right panel left open last time opens again and is reported as visible", () => {
  const page = open({ state: { collapsed: {}, panels: { right: { hidden: false } } } });
  assert.deepEqual(page.takePosted(), [{ type: "rightPanelVisibility", visible: true }, { type: "ready" }]);
  assert.equal(page.byId("rightPanel").classList.contains("hidden"), false);
});

test("dragging the left handle resizes the panel live, clamps it, and saves the width on release", () => {
  const page = openWith(ITEMS);
  const handle = page.byId("rsz-left");
  const width = (): string => page.document.documentElement.style.getPropertyValue("--launcher-left-w");
  page.fire(handle, "mousedown", { button: 0, clientX: 100 });
  assert.equal(handle.classList.contains("dragging"), true);
  assert.equal(page.document.body.classList.contains("resizing"), true);
  page.fire(page.document, "mousemove", { clientX: 150 });
  assert.equal(width(), "270px");
  page.fire(page.document, "mousemove", { clientX: 5000 });
  assert.equal(width(), `${LEFT_PANEL_LIMITS.max}px`);
  assert.equal(page.states.length, 0, "nothing is saved mid-drag");
  page.fire(page.document, "mouseup");
  assert.deepEqual((lastState(page).panels as Record<string, unknown>).left, { width: LEFT_PANEL_LIMITS.max });
  assert.equal(handle.classList.contains("dragging"), false);
  assert.equal(page.document.body.classList.contains("resizing"), false);
  assert.equal(page.document.listenerCount("mousemove"), 0);
  assert.equal(page.document.listenerCount("mouseup"), 0);
});

test("the right handle grows leftward, and a non-primary button does not start a drag", () => {
  const page = openWith(ITEMS);
  page.receive({ type: "toggleRightPanel" });
  const handle = page.byId("rsz-right");
  page.fire(handle, "mousedown", { button: 2, clientX: 500 });
  assert.equal(handle.classList.contains("dragging"), false);
  page.fire(handle, "mousedown", { button: 0, clientX: 500 });
  page.fire(page.document, "mousemove", { clientX: 450 });
  assert.equal(page.document.documentElement.style.getPropertyValue("--launcher-right-w"), "310px");
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

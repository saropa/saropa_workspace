// Behavior tests for the Mobile Remote Control webview: the real shell and script run
// together in the fake DOM, fed catalog payloads like the host sends.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRemoteControlHtml } from "../views/remoteControl/remoteControlShell";
import { runPage, type FakeElement, type Page, type PageOptions } from "./_stub/fakeDom";

const EVIL = '<img src=x onerror="alert(1)">&"\'';

const STRINGS = {
  run: "Run", pin: "Pin", pinTitle: "Pin to the launcher", prompts: "Asks first", promptsTitle: "Prompts for values",
  missingProject: "No project", missingProjectTitle: "Needs an Android project", autoFilled: "Filled: {tokens}",
  destructive: "Destructive", destructiveTitle: "Cannot be undone", requiresDevice: "Needs device", minSdk: "SDK {level}+",
  empty: "Nothing matches", count: "{n} commands", countFiltered: "{shown} of {total}",
  projectPackage: "Package {id}", projectFlutter: "Flutter", projectNone: "No Android project", projectVariants: "{n} variants",
  adbRefresh: "Recheck", adbRefreshTitle: "Look for adb again", adbChecking: "Checking adb",
};

function cmd(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, label: `Label ${id}`, description: `About ${id}`, commandTemplate: `adb ${id} {device}`, command: `adb ${id} emulator-5554`,
    autoFilled: [], prompts: false, missingProject: false, requiresDevice: false, destructive: false, ...extra,
  };
}
function group(id: string, commands: Record<string, unknown>[]): Record<string, unknown> {
  return { id, label: `Group ${id}`, description: `Blurb ${id}`, commands };
}
function payload(groups: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const total = groups.reduce((n, g) => n + (g.commands as unknown[]).length, 0);
  return { query: "", groups, shown: total, total, strings: STRINGS, ...extra };
}
function open(options: PageOptions = {}): Page {
  return runPage(renderRemoteControlHtml(), options);
}
function openWith(groups: Record<string, unknown>[], extra: Record<string, unknown> = {}, options: PageOptions = {}): Page {
  const page = open(options);
  page.receive({ type: "catalog", payload: payload(groups, extra) });
  page.takePosted();
  return page;
}
const text = (els: FakeElement[]): string[] => els.map((e) => e.textContent);

test("loading tells the host the panel is ready", () => {
  assert.deepEqual(open().takePosted(), [{ type: "ready" }]);
});

test("a catalog message renders each group with its label, count and blurb, and each command's lines", () => {
  const page = openWith([group("conn", [cmd("one"), cmd("two")]), group("files", [cmd("three")])]);
  assert.deepEqual(page.all(".group").map((g) => `${g.querySelector(".group-label")!.textContent}:${g.querySelector(".group-count")!.textContent}:${g.querySelector(".group-desc")!.textContent}`), ["Group conn:2:Blurb conn", "Group files:1:Blurb files"]);
  const first = page.one(".card");
  assert.equal(first.dataset.id, "one");
  assert.equal(first.querySelector(".card-name")!.textContent, "Label one");
  assert.equal(first.querySelector(".card-desc")!.textContent, "About one");
  assert.equal(first.querySelector(".card-sub")!.textContent, "adb one emulator-5554");
  assert.equal(first.querySelector(".card-sub")!.title, "adb one {device}");
  assert.equal(page.all(".card").length, 3);
});

test("a second catalog message replaces the first instead of adding to it", () => {
  const page = openWith([group("a", [cmd("one")])]);
  page.receive({ type: "catalog", payload: payload([group("b", [cmd("two")])]) });
  assert.deepEqual(page.all(".card").map((c) => c.dataset.id), ["two"]);
});

test("each command shows only the badges that apply", () => {
  const page = openWith([group("g", [
    cmd("plain"),
    cmd("danger", { destructive: true }),
    cmd("filled", { autoFilled: ["package", "device"] }),
    cmd("both", { autoFilled: ["package"], missingProject: true }),
    cmd("prompting", { prompts: true, requiresDevice: true, minSdk: 28 }),
  ])]);
  const badges = (id: string): string[] => page.one(`.card[data-id="${id}"]`).querySelectorAll(".badge").map((b) => `${b.className}|${b.textContent}|${b.title}`);
  assert.deepEqual(badges("plain"), []);
  assert.deepEqual(badges("danger"), ["badge danger|Destructive|Cannot be undone"]);
  assert.deepEqual(badges("filled"), ["badge|Filled: package, device|"]);
  assert.deepEqual(badges("both"), ["badge|No project|Needs an Android project"]);
  assert.deepEqual(badges("prompting"), ["badge|Asks first|Prompts for values", "badge|Needs device|", "badge|SDK 28+|"]);
});

test("Pin and Run post their exact messages for their own command", () => {
  const page = openWith([group("g", [cmd("one"), cmd("two")])]);
  const [pin, run] = page.all(".card")[1].querySelectorAll(".card-actions .btn");
  assert.deepEqual([pin.textContent, pin.title, run.textContent, run.className], ["Pin", "Pin to the launcher", "Run", "btn primary"]);
  page.click(pin);
  page.click(run);
  assert.deepEqual(page.takePosted(), [{ type: "pin", id: "two" }, { type: "run", id: "two" }]);
});

test("clicking a group head folds it, saves the fold, and the fold is restored on the next load", () => {
  const page = openWith([group("conn", [cmd("one")]), group("files", [cmd("two")])]);
  page.click(page.one(".group-head"));
  assert.deepEqual(page.all(".group.collapsed").length, 1);
  assert.deepEqual(page.states, [{ collapsed: { conn: true } }]);
  page.click(page.one(".group-head"));
  assert.deepEqual(page.states[1], { collapsed: {} });
  const restored = openWith([group("conn", [cmd("one")]), group("files", [cmd("two")])], {}, { state: { collapsed: { files: true } } });
  assert.deepEqual(restored.all(".group").map((g) => g.classList.contains("collapsed")), [false, true]);
});

test("the count shows the total, or shown of total while a search is active", () => {
  const page = openWith([group("g", [cmd("one"), cmd("two")])]);
  assert.equal(page.byId("count").textContent, "2 commands");
  page.receive({ type: "catalog", payload: payload([group("g", [cmd("one")])], { query: "on", shown: 1, total: 2 }) });
  assert.equal(page.byId("count").textContent, "1 of 2");
});

test("typing in the search box posts the query as typed", () => {
  const page = open();
  page.takePosted();
  page.type(page.byId("q"), "  Reboot ");
  assert.deepEqual(page.takePosted(), [{ type: "search", query: "  Reboot " }]);
});

test("no matches shows the empty message; matches hide it", () => {
  const page = openWith([], { shown: 0, total: 5, query: "zzz" });
  assert.equal(page.byId("empty").textContent, "Nothing matches");
  assert.equal(page.byId("empty").classList.contains("hidden"), false);
  assert.equal(page.byId("count").textContent, "0 of 5");
  page.receive({ type: "catalog", payload: payload([group("g", [cmd("one")])]) });
  assert.equal(page.byId("empty").classList.contains("hidden"), true);
});

test("the project chips show the package, variants and Flutter, or that there is no project", () => {
  const page = openWith([]);
  assert.deepEqual(text(page.all("#project .chip")), ["No Android project"]);
  page.receive({ type: "catalog", payload: payload([], { project: { hasAndroidProject: true, isFlutterProject: true, applicationId: "com.example.app", variantCount: 3 } }) });
  assert.deepEqual(page.all("#project .chip").map((c) => `${c.className}|${c.textContent}`), ["chip mono|Package com.example.app", "chip|3 variants", "chip|Flutter"]);
  page.receive({ type: "catalog", payload: payload([], { project: { hasAndroidProject: true, isFlutterProject: false, variantCount: 1 } }) });
  assert.deepEqual(text(page.all("#project .chip")), []);
});

test("the adb chip shows status and tone with the detail as a tooltip; the refresh button posts refreshAdb", () => {
  const page = openWith([], { adb: { available: true, status: "adb 1.0.41", detail: "/sdk/platform-tools/adb", tone: "ok" } });
  const chip = page.one("#adb .chip");
  assert.deepEqual([chip.className, chip.textContent, chip.title], ["chip ok", "adb 1.0.41", "/sdk/platform-tools/adb"]);
  assert.equal(page.byId("notice").classList.contains("hidden"), true);
  const refresh = page.one("#adb .chip-btn");
  assert.deepEqual([refresh.textContent, refresh.title], ["Recheck", "Look for adb again"]);
  page.click(refresh);
  assert.deepEqual(page.takePosted(), [{ type: "refreshAdb" }]);
});

test("before adb has been checked the chip says so and the notice stays hidden", () => {
  const page = openWith([]);
  assert.deepEqual(text(page.all("#adb .chip")), ["Checking adb"]);
  assert.equal(page.one("#adb .chip").className, "chip");
  assert.equal(page.byId("notice").classList.contains("hidden"), true);
});

test("a missing adb shows the notice with its title and body, and a later good check clears it", () => {
  const page = openWith([], { adb: { available: false, status: "adb not found", detail: "", tone: "error", missingTitle: "Install adb", missingBody: "Add platform-tools to PATH" } });
  assert.equal(page.byId("notice").classList.contains("hidden"), false);
  assert.equal(page.byId("notice-title").textContent, "Install adb");
  assert.equal(page.byId("notice-body").textContent, "Add platform-tools to PATH");
  assert.equal(page.one("#adb .chip").className, "chip error");
  page.receive({ type: "catalog", payload: payload([], { adb: { available: true, status: "ok", detail: "d", tone: "ok" } }) });
  assert.equal(page.byId("notice").classList.contains("hidden"), true);
  assert.equal(page.byId("notice-title").textContent, "");
});

test("every host-supplied string is written as text, never as markup", () => {
  const page = openWith(
    [{ id: "g", label: EVIL, description: EVIL, commands: [cmd("one", { label: EVIL, description: EVIL, command: EVIL, commandTemplate: EVIL, autoFilled: [EVIL] })] }],
    { adb: { available: false, status: EVIL, detail: EVIL, tone: "error", missingTitle: EVIL, missingBody: EVIL }, project: { isFlutterProject: false, applicationId: EVIL, variantCount: 1 } },
  );
  assert.equal(page.all("img").length, 0);
  assert.deepEqual(text([page.one(".group-label"), page.one(".group-desc"), page.one(".card-name"), page.one(".card-desc"), page.one(".card-sub")]), [EVIL, EVIL, EVIL, EVIL, EVIL]);
  assert.equal(page.one(".card-sub").title, EVIL);
  assert.equal(page.one(".badge").textContent, `Filled: ${EVIL}`);
  assert.equal(page.one("#project .chip").textContent, `Package ${EVIL}`);
  assert.equal(page.byId("notice-body").textContent, EVIL);
});

test("messages of another type, or none, are ignored", () => {
  const page = openWith([group("g", [cmd("one")])]);
  page.receive({ type: "other", payload: payload([]) });
  page.receive(null);
  page.receive("catalog");
  assert.deepEqual(page.all(".card").map((c) => c.dataset.id), ["one"]);
});

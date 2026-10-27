// Shared setup for the launcher webview tests: opens the real shell + script in the fake DOM
// and builds the host's data message.

import * as vscode from "vscode";
import { renderHtml } from "../views/launcherViewShell";
import { fakeWebviewPanel } from "./_stub/vscodeWebview";
import { runPage, type Page, type PageOptions, FakeDataTransfer, type FakeElement } from "./_stub/fakeDom";
import assert from "node:assert/strict";

export type Item = Record<string, unknown> & { id: string; label: string };

/** The English strings the host sends with every data message. */
export const STRINGS: Record<string, string> = {
  run: "Run", open: "Open", copyPath: "Copy path", pin: "Pin", schedule: "Schedule",
  mine: "My shortcuts", recipes: "Recipes", watches: "Watches", files: "Project files",
  scripts: "Scripts", notes: "Notes", mobileRemote: "Mobile Remote Control",
  sortAsc: "A to Z", sortDesc: "Z to A", sortGrouped: "Grouped",
  count: "{n} items", countFiltered: "{shown} of {total}",
  menuAriaLabel: "Actions for {name}", menuSubAriaLabel: "More actions for {name}",
  runHistoryEmpty: "Nothing run yet", runHistoryDisabled: "History is off",
  runHistoryAriaLabel: "Run history", runHistoryRunAgain: "Run again", runHistoryCount: "{count} runs",
};

export function item(o: Partial<Item> & { id: string; label: string }): Item {
  return {
    sub: "", desc: undefined, pane: "mine", section: "Daily", groupId: "g-daily", groupIcon: "star",
    groupColor: "charts.blue", icon: "file", color: "charts.blue", kind: "file", runnable: true, openable: true,
    ...o,
  };
}

export function open(options: PageOptions = {}): Page {
  const webview = fakeWebviewPanel("saropa.launcher", "Launcher").webview;
  return runPage(renderHtml(webview as unknown as vscode.Webview, vscode.Uri.file("/ext")), options);
}

export function dataMessage(items: Item[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "data", strings: STRINGS, items, categories: [], runHistory: [], tintHexes: {}, ...extra };
}

/** Opens the page, sends the items and drops the boot messages. */
export function openWith(items: Item[], extra: Record<string, unknown> = {}, options: PageOptions = {}): Page {
  const page = open(options);
  page.receive(dataMessage(items, extra));
  page.takePosted();
  return page;
}

export const EVIL = '<img src=x onerror="alert(1)">&"\'';

export const ITEMS = [
  item({ id: "a", label: "Build app", sub: "npm run build", groupId: "g1", section: "Daily" }),
  item({ id: "b", label: "Build docs", groupId: "g1", section: "Daily" }),
  item({ id: "c", label: "Deploy", groupId: "g2", section: "Weekly" }),
  item({ id: "w1", label: "Watch logs", pane: "watches", groupId: "watches", section: "Watches" }),
  item({ id: "/p/pubspec.yaml", label: "pubspec.yaml", pane: "files", groupId: "proj", section: "Project" }),
];

export const CATEGORIES = [
  { id: "all", label: "All", count: 5, icon: "list-flat" },
  { id: "mine", label: "My shortcuts", count: 3, icon: "star-full" },
  { id: "recipes", label: "Recipes", count: 0, icon: "lightbulb" },
];

export const cardNames = (page: Page, scope = ""): string[] =>
  page.all(`${scope} .card:not(.hidden) .card-name`.trim()).map((e) => e.textContent);

export const lastState = (page: Page): Record<string, unknown> => page.states[page.states.length - 1] as Record<string, unknown>;

export const visiblePanes = (page: Page): string[] => page.all(".pane:not(.hidden)").map((p) => p.dataset.pane!);

export const MENU = [
  { command: "a.run", label: "Run", icon: "play", group: "run" },
  { command: "a.edit", label: "Edit", icon: "edit", group: "change" },
  {
    command: "a.more", label: "More", icon: "ellipsis", group: "change",
    children: [{ command: "a.c1", label: "Child 1", icon: "x" }, { command: "a.c2", label: "Child 2", icon: "x", danger: true }],
  },
  { command: "a.del", label: "Delete", icon: "trash", group: "danger", danger: true },
];

export const card = (page: Page, id: string): FakeElement => page.one(`.card[data-shortcut-id="${id}"]`);

export const buttons = (page: Page, id: string): string[] => card(page, id).querySelectorAll(".drawer-actions .btn").map((b) => b.textContent);

export const button = (page: Page, id: string, text: string): FakeElement => {
  const found = card(page, id).querySelectorAll(".drawer-actions .btn").find((b) => b.textContent === text);
  assert.ok(found, `no "${text}" button on ${id}`);
  return found;
};

export const menus = (page: Page): FakeElement[] => page.all(".menu");

export const focusedLabel = (page: Page): string | undefined => page.document.activeElement?.textContent;

export function openMenu(page: Page, x = 40, y = 50): void {
  page.fire(card(page, "c"), "contextmenu", { clientX: x, clientY: y });
}

export const withMenu = (): Page => openWith([item({ id: "c", label: "Deploy", menu: MENU }), item({ id: "d", label: "Plain" })]);

export const DND = [
  item({ id: "a", label: "A", groupId: "g1" }),
  item({ id: "b", label: "B", groupId: "g1" }),
  item({ id: "c", label: "C", groupId: "g2", section: "Weekly" }),
  item({ id: "w", label: "W", pane: "watches", groupId: "watches" }),
];

export const head = (page: Page, group: string): FakeElement => page.one(`.group[data-group-id="${group}"] .group-head`);

export const wrap = (page: Page, group: string): FakeElement => page.one(`.group[data-group-id="${group}"]`);

export const drag = (page: Page, id: string): FakeDataTransfer => {
  const dataTransfer = new FakeDataTransfer();
  page.fire(card(page, id), "dragstart", { dataTransfer });
  return dataTransfer;
};

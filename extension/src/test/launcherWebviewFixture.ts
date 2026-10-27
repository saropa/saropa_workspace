// Shared setup for the launcher webview tests: opens the real shell + script in the fake DOM
// and builds the host's data message.

import * as vscode from "vscode";
import { renderHtml } from "../views/launcherViewShell";
import { fakeWebviewPanel } from "./_stub/vscodeWebview";
import { runPage, type Page, type PageOptions } from "./_stub/fakeDom";

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

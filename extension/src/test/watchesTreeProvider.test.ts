// Tests for the Watches view: which watches are listed in this window, the row state
// (idle, unseen, global, off), tooltip, context value and click command, and the repaint
// and count events.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setWorkspaceFolders, __fireHostEvent, __resetHosts, Uri } from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { FolderWatchStore, type FolderWatch } from "../model/folderWatch";
import { WatchesTreeProvider, WatchTreeItem } from "../views/watchesTreeProvider";
import { l10n } from "../i18n/l10n";

let store: FolderWatchStore;
let provider: WatchesTreeProvider;

const watch = (over: Partial<FolderWatch>): FolderWatch =>
  ({ id: "w", target: "/proj/bugs", isFile: false, mode: "new", enabled: true, ...over });
const rows = (): WatchTreeItem[] => provider.getChildren() as WatchTreeItem[];
const icon = (row: WatchTreeItem): { id: string; color?: { id: string } } => row.iconPath as { id: string; color?: { id: string } };

beforeEach(() => {
  __setWorkspaceFolders([{ uri: Uri.file("/proj"), name: "proj", index: 0 }]);
  store = new FolderWatchStore(fakeContext());
  provider = new WatchesTreeProvider(store);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetHosts();
});

test("a watch inside an open folder is listed; one elsewhere is hidden", async () => {
  await store.add(watch({ id: "in", target: "/proj/bugs" }));
  await store.add(watch({ id: "out", target: "/other/place" }));
  assert.deepEqual(rows().map((r) => r.watch.id), ["in"]);
  assert.equal(provider.count, 1);
});

test("a watch opted into this project, and a global watch, are listed", async () => {
  await store.add(watch({ id: "opted", target: "/other/a", alertScopes: ["/proj"] }));
  await store.add(watch({ id: "glob", target: "/other/b", global: true }));
  assert.deepEqual(rows().map((r) => r.watch.id), ["opted", "glob"]);
  assert.equal(rows()[1].isGlobal, true);
});

test("a row has no children and getTreeItem returns it unchanged", async () => {
  await store.add(watch({}));
  const [row] = rows();
  assert.deepEqual(provider.getChildren(row), []);
  assert.equal(provider.getTreeItem(row), row);
});

test("an idle folder watch reads kind and mode with the eye icon", async () => {
  await store.add(watch({ target: "/proj/bugs" }));
  const [row] = rows();
  assert.equal(row.label, "bugs");
  assert.equal(row.description, "folder - Only new files");
  assert.equal(icon(row).id, "eye");
  assert.equal(icon(row).color, undefined);
  assert.equal(row.contextValue, "watchEnabled");
});

test("unseen files lead the description and tint a bell glyph blue", async () => {
  await store.add(watch({ mode: "changed" }));
  await store.addUnseen("w", ["a.md", "b.md"]);
  const [row] = rows();
  assert.equal(row.unseen, 2);
  assert.equal(row.description, "2 new - folder - New and changed files");
  assert.deepEqual([icon(row).id, icon(row).color?.id], ["bell-dot", "charts.blue"]);
});

test("a repo watch keeps the GitHub glyph when it has unseen items", async () => {
  await store.add(watch({ kind: "repo", target: "saropa/saropa_workspace", alertScopes: ["/proj"] }));
  await store.addUnseen("w", ["pr:1"]);
  const [row] = rows();
  assert.equal(row.label, "saropa/saropa_workspace");
  assert.equal(row.description, `1 new - repo - ${l10n("github.modeNewItems")}`);
  assert.deepEqual([icon(row).id, icon(row).color?.id], ["github", "charts.blue"]);
});

test("a global watch shows a globe, tinted only when it has unseen files", async () => {
  await store.add(watch({ target: "/other/x", global: true }));
  assert.equal(rows()[0].description, "global - folder - Only new files");
  assert.deepEqual([icon(rows()[0]).id, icon(rows()[0]).color], ["globe", undefined]);
  await store.addUnseen("w", ["f"]);
  assert.equal(rows()[0].description, "1 new - global - folder - Only new files");
  assert.deepEqual([icon(rows()[0]).id, icon(rows()[0]).color?.id], ["globe", "charts.blue"]);
});

test("a disabled watch reads as off with a closed eye, whatever else is true", async () => {
  await store.add(watch({ enabled: false, global: true }));
  await store.addUnseen("w", ["f"]);
  const [row] = rows();
  assert.equal(row.description, "off - folder - Only new files");
  assert.equal(icon(row).id, "eye-closed");
  assert.equal(row.contextValue, "watchDisabled");
});

test("a file watch and a custom label use their own wording", async () => {
  await store.add(watch({ isFile: true, label: "Release notes" }));
  const [row] = rows();
  assert.equal(row.label, "Release notes");
  assert.equal(row.description, "file - Only new files");
});

test("the tooltip names the target, the kind, the mode and the reach", async () => {
  await store.add(watch({}));
  await store.add(watch({ id: "g", target: "/other/g", global: true }));
  const [local, global] = rows();
  assert.equal(local.tooltip, l10n("watchesView.rowTooltip", {
    target: "/proj/bugs", kind: "folder", mode: "Only new files", scope: "Alerts in this project.",
  }));
  assert.match(String(global.tooltip), /Global - alerts in every project\./);
});

test("clicking a row opens the watch by id", async () => {
  await store.add(watch({ id: "w9" }));
  assert.deepEqual(rows()[0].command, {
    command: "saropaWorkspace.openWatch",
    title: l10n("watchesView.openTitle"),
    arguments: ["w9"],
  });
});

test("the count follows what is listed and fires only when it changes", async () => {
  const counts: number[] = [];
  provider.onDidChangeCount((n) => counts.push(n));
  await store.add(watch({ id: "a", target: "/proj/a" }));
  rows();
  rows();
  await store.add(watch({ id: "b", target: "/proj/b" }));
  rows();
  assert.deepEqual(counts, [1, 2]);
  assert.equal(provider.count, 2);
});

test("a list change, a count change and a folder change each repaint", async () => {
  let repaints = 0;
  provider.onDidChangeTreeData(() => repaints++);
  await store.add(watch({}));
  await store.addUnseen("w", ["f"]);
  __fireHostEvent("foldersChanged", {});
  assert.equal(repaints, 3);
});

// Tests for the structural rows of the Shortcuts tree: the Recent root, the two scope roots
// and group folders. Their ids and context values are matched by menu clauses, so the exact
// strings, the collapse state and the icon rules are the behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RecentRootItem, ShortcutGroupItem, ShortcutFolderItem } from "../views/shortcutTreeItems";
import { l10n } from "../i18n/l10n";

const icon = (row: { iconPath?: unknown }): { id: string; color?: { id: string } } =>
  row.iconPath as { id: string; color?: { id: string } };

test("the Recent root shows its count, a history icon and its own context value", () => {
  const row = new RecentRootItem(4, false);
  assert.equal(row.label, l10n("recent.group"));
  assert.deepEqual([row.id, row.contextValue, row.description], ["scope:recent", "recentRoot", "4"]);
  assert.equal(icon(row).id, "history");
});

test("the Recent root opens expanded or collapsed as asked", () => {
  assert.equal(new RecentRootItem(1, true).collapsibleState, 2);
  assert.equal(new RecentRootItem(1, false).collapsibleState, 1);
});

test("a scope root is always expanded and carries its scope in the id", () => {
  const project = new ShortcutGroupItem("Project Shortcuts", "project", 3);
  const global = new ShortcutGroupItem("Global Shortcuts", "global", 0);
  assert.deepEqual([project.id, project.collapsibleState, project.contextValue, project.description], ["scope:project", 2, "scopeRoot", "3"]);
  assert.deepEqual([global.id, global.description], ["scope:global", "0"]);
  assert.deepEqual([icon(project).id, icon(global).id], ["root-folder", "globe"]);
  assert.equal(project.group, "project");
});

test("a user group is a collapsible folder keyed by scope and group id", () => {
  const expanded = new ShortcutFolderItem({ id: "g1", label: "Docs", order: 0 }, "project", 2);
  const collapsed = new ShortcutFolderItem({ id: "g2", label: "Misc", order: 1, collapsed: true }, "global", 5);
  assert.deepEqual([expanded.label, expanded.id, expanded.collapsibleState, expanded.contextValue, expanded.description], ["Docs", "group:project:g1", 2, "userGroup", "2"]);
  assert.deepEqual([collapsed.id, collapsed.collapsibleState, collapsed.description], ["group:global:g2", 1, "5"]);
  assert.equal(expanded.scope, "project");
  assert.equal(expanded.shortcutGroup.id, "g1");
});

test("a plain user group uses the gray folder icon with no tint", () => {
  const row = new ShortcutFolderItem({ id: "g1", label: "Docs", order: 0 }, "project", 0);
  assert.deepEqual([icon(row).id, icon(row).color], ["folder", undefined]);
});

test("a group with its own glyph and color shows both", () => {
  const row = new ShortcutFolderItem({ id: "r1", label: "GitHub", order: 0, icon: "github", color: "charts.green" }, "project", 1);
  assert.deepEqual([icon(row).id, icon(row).color?.id], ["github", "charts.green"]);
});

test("a built-in default group gets its own context value so edit actions stay hidden", () => {
  const row = new ShortcutFolderItem({ id: "default:build", label: "Build", order: 0 }, "project", 1);
  assert.equal(row.contextValue, "defaultGroup");
});

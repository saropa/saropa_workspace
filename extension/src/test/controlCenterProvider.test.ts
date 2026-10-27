// Tests for the Control Center view: the flat section index, its ordering by project shape,
// the row wiring (title, icon, tooltip, context value, click command) and the repaint events.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setWorkspaceFolders } from "./_stub/vscode";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle } from "./settle";
import { ControlCenterProvider, SectionTreeItem } from "../views/controlCenterProvider";
import { SECTION_REGISTRY, orderedSections } from "../model/sections";
import { emptyAndroidProjectProfile, invalidateAndroidProjectProfile } from "../model/androidProjectProfile";
import { l10n } from "../i18n/l10n";

const ids = (provider: ControlCenterProvider): string[] =>
  provider.getChildren().map((row) => (row as SectionTreeItem).section.id);

beforeEach(() => {
  __setWorkspaceFolders(undefined);
  invalidateAndroidProjectProfile();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  invalidateAndroidProjectProfile();
});

test("with no workspace folder every section is listed in registry order", () => {
  const provider = new ControlCenterProvider();
  assert.deepEqual(ids(provider), SECTION_REGISTRY.map((s) => s.id));
});

test("a row carries the section title, icon, tooltip, context value and entry command", () => {
  const provider = new ControlCenterProvider();
  const first = SECTION_REGISTRY[0];
  const row = provider.getChildren()[0] as SectionTreeItem;
  const title = l10n(first.titleKey);
  assert.equal(row.label, title);
  assert.equal(row.collapsibleState, 0);
  assert.equal((row.iconPath as { id: string }).id, first.icon);
  assert.equal(row.tooltip, l10n("controlCenter.rowTooltip", { section: title }));
  assert.equal(row.contextValue, `section:${first.id}`);
  assert.deepEqual(row.command, { command: first.entryCommand, title });
});

test("a row has no children and getTreeItem returns the row itself", () => {
  const provider = new ControlCenterProvider();
  const row = provider.getChildren()[0];
  assert.deepEqual(provider.getChildren(row), []);
  assert.equal(provider.getTreeItem(row), row);
});

test("an Android profile keeps every section, with Mobile Remote Control last", () => {
  const provider = new ControlCenterProvider();
  const android = { ...emptyAndroidProjectProfile(), hasAndroidProject: true };
  provider.setProfile(android);
  assert.deepEqual(ids(provider), orderedSections(android).map((s) => s.id));
  assert.equal(ids(provider).length, SECTION_REGISTRY.length);
  assert.equal(ids(provider)[ids(provider).length - 1], "mobileRemoteControl");
});

test("setting a profile and refreshing both repaint the tree", () => {
  const provider = new ControlCenterProvider();
  let repaints = 0;
  provider.onDidChangeTreeData(() => repaints++);
  provider.setProfile(emptyAndroidProjectProfile());
  provider.refresh();
  assert.equal(repaints, 2);
});

test("the project profile read at startup repaints and reorders the rows", async () => {
  const fx: FsFixture = createFsFixture("sw-ccenter-");
  try {
    fx.write("android/.keep");
    const provider = new ControlCenterProvider();
    let repaints = 0;
    provider.onDidChangeTreeData(() => repaints++);
    await settle(() => repaints > 0);
    const android = { ...emptyAndroidProjectProfile(), hasAndroidProject: true };
    assert.deepEqual(ids(provider), orderedSections(android).map((s) => s.id));
  } finally {
    fx.remove();
  }
});

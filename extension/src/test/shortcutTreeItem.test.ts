// Tests for the Shortcuts tree row: the label and untapped marker, the id namespaces, the
// file icon rules, masked rows that reveal nothing, comment and separator rows, the
// screen-reader label priority, and the click command.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Uri, __resetConfig, __setConfig } from "./_stub/vscode";
import { ShortcutTreeItem, type ShortcutTreeItemOptions } from "../views/shortcutTreeItem";
import type { Shortcut } from "../model/shortcut";
import { l10n } from "../i18n/l10n";

const file = (over: Partial<Shortcut> = {}): Shortcut =>
  ({ id: "s1", path: "src/app.ts", scope: "project", order: 0, ...over }) as Shortcut;
const row = (shortcut: Shortcut, rest: Partial<ShortcutTreeItemOptions> = {}): ShortcutTreeItem =>
  new ShortcutTreeItem({ shortcut, ...rest });
const a11y = (item: ShortcutTreeItem): string =>
  (item as unknown as { accessibilityInformation: { label: string } }).accessibilityInformation.label;

beforeEach(() => __resetConfig());
afterEach(() => __resetConfig());

test("a file row is named after the file, has no children and is not recent", () => {
  const item = row(file());
  assert.equal(item.label, "app.ts");
  assert.equal(item.collapsibleState, 0);
  assert.equal(item.isRecent, false);
  assert.equal(item.shortcut.id, "s1");
});

test("a label on the shortcut wins over the file name", () => {
  assert.equal(row(file({ label: "Entry point" })).label, "Entry point");
});

test("the title-case setting reshapes the file name", () => {
  __setConfig("saropaWorkspace", "displayNames.titleCase", true);
  assert.equal(row(file({ path: "scripts/setup_arb-translate.py" })).label, "Setup Arb Translate");
});

test("an untapped row leads its name with a dot", () => {
  assert.equal(row(file(), { untapped: true }).label, "● app.ts");
});

test("the id is scoped, and a recent entry has its own namespace", () => {
  assert.equal(row(file()).id, "shortcut:project:s1");
  assert.equal(row(file({ scope: "global" })).id, "shortcut:global:s1");
  const recent = row(file(), { recentInfo: { at: 1, source: "tree" as never } });
  assert.deepEqual([recent.id, recent.isRecent], ["recent:project:s1", true]);
});

test("a file row takes its resource from the resolved uri; other kinds do not", () => {
  const uri = Uri.file("/proj/src/app.ts");
  assert.equal(row(file(), { resolvedUri: uri as never }).resourceUri, uri);
  const url = file({ action: { kind: "url", url: "https://example.com" } as never });
  assert.equal(row(url, { resolvedUri: uri as never }).resourceUri, undefined);
});

test("a masked row shows a generic name and no resource, and leaks nothing in its text", () => {
  const item = row(file({ masked: true, path: "secrets/vault.kdbx" }), { resolvedUri: Uri.file("/proj/secrets/vault.kdbx") as never });
  assert.equal(item.label, l10n("mask.label"));
  assert.equal(item.resourceUri, undefined);
  assert.doesNotMatch(String(item.tooltip) + String(item.description), /vault|kdbx|secrets/);
  assert.equal(a11y(item), l10n("mask.label"));
});

test("a normal row clicks through the activation command with its shortcut", () => {
  const shortcut = file();
  assert.deepEqual(row(shortcut).command, { command: "saropaWorkspace.activatePin", title: "Activate", arguments: [shortcut] });
});

test("the context value follows the run state and the shortcut kind", () => {
  assert.equal(row(file()).contextValue, "shortcut");
  assert.equal(row(file(), { isRunning: true }).contextValue, "shortcutRunning");
  assert.equal(row(file(), { isStopping: true, isRunning: true }).contextValue, "shortcutStopping");
  assert.equal(row(file({ isAuto: true })).contextValue, "shortcutAuto");
  assert.equal(row(file({ isRecipe: true })).contextValue, "shortcutRecipe");
});

test("a row always has a tooltip, a description and an icon from the row builders", () => {
  const item = row(file(), { resolvedUri: Uri.file("/proj/src/app.ts") as never });
  assert.match(String(item.tooltip), /app\.ts/);
  assert.ok(item.iconPath !== undefined);
});

test("the screen-reader label is the name alone when nothing special is true", () => {
  assert.equal(a11y(row(file())), "app.ts");
});

test("the screen-reader label adds the highest-priority state", () => {
  assert.equal(a11y(row(file(), { isStopping: true, isRunning: true, lockedBy: "Build", missing: true })), `app.ts, ${l10n("run.stoppingBadge")}`);
  assert.equal(a11y(row(file(), { isRunning: true, lockedBy: "Build" })), `app.ts, ${l10n("run.treeBadge")}`);
  assert.equal(a11y(row(file(), { lockedBy: "Build" })), `app.ts, ${l10n("depends.treeBadge", { dep: "Build" })}`);
  assert.equal(a11y(row(file({ paused: true }), { missing: true })), `app.ts, ${l10n("pause.treeBadge")}`);
});

test("a missing or untapped target is spoken when no live state applies", () => {
  assert.equal(a11y(row(file(), { missing: true, untapped: true })), `app.ts, ${l10n("a11y.missingState")}`);
  assert.equal(a11y(row(file(), { untapped: true })), `app.ts, ${l10n("a11y.untappedState")}`);
});

test("the screen-reader name is the plain name, without the untapped dot", () => {
  assert.equal(a11y(row(file(), { untapped: true })).startsWith("app.ts,"), true);
});

test("a comment row shows its trimmed text, a comment icon and does nothing on click", () => {
  const item = row({ id: "c", path: "", scope: "project", order: 0, label: "  Deploy scripts  ", action: { kind: "comment" } } as unknown as Shortcut, { untapped: true, resolvedUri: Uri.file("/x") as never });
  assert.equal(item.label, "Deploy scripts");
  assert.equal(item.tooltip, "Deploy scripts");
  assert.equal(item.contextValue, "annotationComment");
  assert.equal(item.command, undefined);
  assert.equal(item.resourceUri, undefined);
  assert.deepEqual((item.iconPath as { id: string; color: { id: string } }).id, "comment");
  assert.equal((item.iconPath as { color: { id: string } }).color.id, "descriptionForeground");
  assert.equal(a11y(item), "Deploy scripts");
});

test("an empty comment row shows a placeholder", () => {
  const item = row({ id: "c", path: "", scope: "project", order: 0, label: "   ", action: { kind: "comment" } } as unknown as Shortcut);
  assert.equal(item.label, l10n("annotation.commentEmpty"));
});

test("a separator row is a rule of forty dashes with the separator role", () => {
  const item = row({ id: "d", path: "", scope: "project", order: 0, action: { kind: "separator" } } as unknown as Shortcut);
  assert.equal(item.label, "─".repeat(40));
  assert.equal(item.contextValue, "annotationSeparator");
  assert.equal(item.tooltip, l10n("annotation.separatorTooltip"));
  assert.equal(item.iconPath, undefined);
  assert.equal(item.command, undefined);
  assert.deepEqual((item as unknown as { accessibilityInformation: unknown }).accessibilityInformation, { label: l10n("a11y.separator"), role: "separator" });
});

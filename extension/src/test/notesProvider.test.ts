// Tests for the Notes view: project notes first, the collapsible Global Notes group, the
// count badge and its change event, the relative-age description, the lazy hover preview
// and the repaint on store changes.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { Uri, MarkdownString } from "./_stub/vscode";
import { registrarContext } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { NoteStore, type NoteEntry } from "../model/noteStore";
import { NotesTreeProvider, NoteTreeItem } from "../views/notesProvider";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: NoteStore;
let provider: NotesTreeProvider;

const label = (item: { label?: unknown }): string => String(item.label);
const entry = (mtime: number, scope: "project" | "global" = "project"): NoteEntry =>
  ({ filename: "n.md", uri: Uri.file(`${fx.dir}/n.md`), scope, mtime }) as unknown as NoteEntry;

beforeEach(() => {
  fx = createFsFixture("sw-notesview-");
  const context = Object.assign(registrarContext(), { globalStorageUri: Uri.file(`${fx.dir}/global`) });
  store = new NoteStore(context);
  provider = new NotesTreeProvider(store);
});

afterEach(() => {
  mock.timers.reset();
  fx.remove();
});

test("with no notes the root is empty and the count stays zero", async () => {
  assert.deepEqual(await provider.getChildren(), []);
  assert.equal(provider.count, 0);
});

test("project notes are listed by name, then one expanded Global Notes group", async () => {
  fx.write(".saropa/notes/b.md", "b");
  fx.write(".saropa/notes/a.md", "a");
  fx.write("global/notes/g.md", "g");
  const roots = await provider.getChildren();
  assert.deepEqual(roots.map(label), ["a.md", "b.md", l10n("notes.globalRoot")]);
  assert.equal(roots[2].collapsibleState, 2);
  assert.equal(roots[2].contextValue, "notesScopeRoot");
  assert.equal((roots[2].iconPath as { id: string }).id, "globe");
  const globals = await provider.getChildren(roots[2]);
  assert.deepEqual(globals.map(label), ["g.md"]);
  assert.equal(globals[0].contextValue, "noteGlobal");
  assert.equal(roots[0].contextValue, "noteProject");
});

test("global notes alone give only the group row; no group row when there are none", async () => {
  fx.write("global/notes/g.md", "g");
  assert.deepEqual((await provider.getChildren()).map(label), [l10n("notes.globalRoot")]);
  nodeFs.rmSync(`${fx.dir}/global`, { recursive: true });
  assert.deepEqual(await provider.getChildren(), []);
});

test("a note row has no children", async () => {
  fx.write(".saropa/notes/a.md", "a");
  const [row] = await provider.getChildren();
  assert.deepEqual(await provider.getChildren(row), []);
  assert.equal(provider.getTreeItem(row), row);
});

test("the count covers project and global notes and fires only when it changes", async () => {
  fx.write(".saropa/notes/a.md", "a");
  fx.write("global/notes/g.md", "g");
  const counts: number[] = [];
  provider.onDidChangeCount((n) => counts.push(n));
  await provider.getChildren();
  await provider.getChildren();
  assert.equal(provider.count, 2);
  assert.deepEqual(counts, [2]);
  fx.write(".saropa/notes/b.md", "b");
  await provider.getChildren();
  assert.deepEqual(counts, [2, 3]);
});

test("a store change or a refresh repaints the tree", () => {
  let repaints = 0;
  provider.onDidChangeTreeData(() => repaints++);
  store.fire();
  provider.refresh();
  assert.equal(repaints, 2);
});

test("a row opens its file and shows the path as the tooltip", () => {
  const item = new NoteTreeItem(entry(0));
  assert.equal(item.tooltip, `${fx.dir}/n.md`);
  assert.equal(item.collapsibleState, 0);
  assert.equal((item.iconPath as { id: string }).id, "note");
  assert.equal(item.resourceUri?.fsPath, `${fx.dir}/n.md`);
  assert.deepEqual(item.command, { command: "vscode.open", title: l10n("notes.open"), arguments: [item.note.uri] });
});

test("the description is the age of the note, bucketed by minute, hour and day", () => {
  const now = 1_700_000_000_000;
  mock.timers.enable({ apis: ["Date"], now });
  const age = (ms: number): string | boolean | undefined => new NoteTreeItem(entry(now - ms)).description;
  const MIN = 60_000;
  assert.equal(age(59_999), "just now");
  assert.equal(age(MIN), "1m ago");
  assert.equal(age(59 * MIN), "59m ago");
  assert.equal(age(60 * MIN), "1h ago");
  assert.equal(age(23 * 60 * MIN + 59 * MIN), "23h ago");
  assert.equal(age(24 * 60 * MIN), "1d ago");
  assert.equal(age(10 * 24 * 60 * MIN), "10d ago");
});

test("a note with no modified time has no description", () => {
  assert.equal(new NoteTreeItem(entry(0)).description, undefined);
});

test("hovering a note loads its first lines as a Markdown tooltip", async () => {
  fx.write(".saropa/notes/a.md", "line one\nline two");
  const [row] = await provider.getChildren();
  const resolved = (await provider.resolveTreeItem(row)) as NoteTreeItem;
  assert.ok(resolved.tooltip instanceof MarkdownString);
  assert.equal((resolved.tooltip as MarkdownString).value, "line one\nline two");
  assert.equal((resolved.tooltip as MarkdownString).supportThemeIcons, true);
});

test("hovering an empty or unreadable note keeps the path tooltip", async () => {
  fx.write(".saropa/notes/empty.md", "");
  const [row] = await provider.getChildren();
  const resolved = (await provider.resolveTreeItem(row)) as NoteTreeItem;
  assert.equal(resolved.tooltip, `${fx.dir}/.saropa/notes/empty.md`);
});

test("hovering a row that is not a note returns it unchanged", async () => {
  fx.write("global/notes/g.md", "g");
  const [group] = await provider.getChildren();
  assert.equal(await provider.resolveTreeItem(group), group);
  assert.equal(group.tooltip, undefined);
});

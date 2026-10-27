// Tests for saved editor layouts: capturing the text tabs into contiguous columns,
// the stored shape, and restoring with partial failures counted.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  Uri,
  TabInputText,
  __setTabGroups,
  __resetHosts,
  __setInputHandler,
  __setPickHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
  __recordedCommands,
  __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { saveLayout, restoreLayout } from "../commands/layoutShortcuts";

const KEY = "saropaWorkspace.editorLayouts";
const win = vscode.window as unknown as Record<string, unknown>;
const ws = vscode.workspace as unknown as Record<string, unknown>;
const realShow = win.showTextDocument;
const realOpen = ws.openTextDocument;

function tab(path: string): { input: unknown } {
  return { input: new TabInputText(Uri.file(path)) };
}

beforeEach(() => {
  __resetHosts();
  __resetHandlers();
  __resetWarnings();
  __resetInfo();
  __resetRecordedCommands();
});

afterEach(() => {
  win.showTextDocument = realShow;
  ws.openTextDocument = realOpen;
  __resetHosts();
  __resetHandlers();
  __resetWarnings();
  __resetInfo();
  __resetRecordedCommands();
});

test("with no text editors open it warns and stores nothing", async () => {
  const ctx = fakeContext();
  __setTabGroups([{ viewColumn: 1, tabs: [{ input: { notText: true } }] }]);
  await saveLayout(ctx as never);
  assert.deepEqual(__warningMessages(), ["No text editors are open to save as a layout."]);
  assert.equal(ctx.globalState.get(KEY), undefined);
});

test("columns are renumbered to a gap-free 1..N and non-text tabs are skipped", async () => {
  const ctx = fakeContext();
  __setTabGroups([
    { viewColumn: 1, tabs: [tab("/a.ts"), { input: "diff" }] },
    { viewColumn: 3, tabs: [tab("/b.ts"), tab("/c.ts")] },
  ]);
  __setInputHandler(async () => "  Hero  ");
  await saveLayout(ctx as never);
  assert.deepEqual(ctx.globalState.get(KEY), [
    {
      name: "Hero",
      columns: 2,
      tabs: [
        { uri: "/a.ts", viewColumn: 1 },
        { uri: "/b.ts", viewColumn: 2 },
        { uri: "/c.ts", viewColumn: 2 },
      ],
    },
  ]);
  assert.deepEqual(__infoMessages(), ["Saved layout Hero (3 editor(s)). Restore it from the Shortcuts toolbar."]);
});

test("a blank or canceled name stores nothing", async () => {
  const ctx = fakeContext();
  __setTabGroups([{ viewColumn: 1, tabs: [tab("/a.ts")] }]);
  await saveLayout(ctx as never);
  __setInputHandler(async () => "   ");
  await saveLayout(ctx as never);
  assert.equal(ctx.globalState.get(KEY), undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("saving under an existing name replaces that layout and keeps the others", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(KEY, [
    { name: "Keep", columns: 1, tabs: [{ uri: "/k.ts", viewColumn: 1 }] },
    { name: "Same", columns: 1, tabs: [{ uri: "/old.ts", viewColumn: 1 }] },
  ]);
  __setTabGroups([{ viewColumn: 2, tabs: [tab("/new.ts")] }]);
  __setInputHandler(async () => "Same");
  await saveLayout(ctx as never);
  const stored = ctx.globalState.get<Array<{ name: string; tabs: Array<{ uri: string }> }>>(KEY)!;
  assert.deepEqual(stored.map((l) => l.name), ["Keep", "Same"]);
  assert.deepEqual(stored[1].tabs, [{ uri: "/new.ts", viewColumn: 1 }]);
});

test("garbage stored layouts are ignored when saving", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(KEY, [null, 5, { name: 3, tabs: [] }, { name: "nt" }, { name: "ok", columns: 1, tabs: [] }]);
  __setTabGroups([{ viewColumn: 1, tabs: [tab("/a.ts")] }]);
  __setInputHandler(async () => "New");
  await saveLayout(ctx as never);
  assert.deepEqual(ctx.globalState.get<Array<{ name: string }>>(KEY)!.map((l) => l.name), ["ok", "New"]);
});

test("restoring with nothing saved warns", async () => {
  await restoreLayout(fakeContext() as never);
  assert.deepEqual(__warningMessages(), ["No saved layouts yet. Arrange your editors, then Save Editor Layout."]);
});

test("restoring lists layouts with counts, builds the grid, then reopens each tab in its column", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(KEY, [
    {
      name: "Two",
      columns: 2,
      tabs: [
        { uri: "/a.ts", viewColumn: 1 },
        { uri: "/b.ts", viewColumn: 2 },
      ],
    },
  ]);
  let shown: Array<{ label: string; description: string }> = [];
  __setPickHandler(async (items) => {
    shown = items as typeof shown;
    return items[0];
  });
  const shows: Array<{ path: string; options: unknown }> = [];
  win.showTextDocument = async (doc: { uri: { fsPath: string } }, options: unknown) => {
    shows.push({ path: doc.uri.fsPath, options });
  };
  await restoreLayout(ctx as never);
  assert.deepEqual(shown.map((i) => [i.label, i.description]), [["Two", "2 editor(s), 2 column(s)"]]);
  assert.deepEqual(__recordedCommands(), [
    { command: "vscode.setEditorLayout", args: [{ orientation: 0, groups: [{}, {}] }] },
  ]);
  assert.deepEqual(shows, [
    { path: "/a.ts", options: { viewColumn: 1, preview: false } },
    { path: "/b.ts", options: { viewColumn: 2, preview: false } },
  ]);
  assert.deepEqual(__infoMessages(), ["Restored layout Two (2 editor(s))."]);
});

test("a tab that no longer opens is skipped and counted while the rest restore", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(KEY, [
    {
      name: "Mixed",
      columns: 1,
      tabs: [
        { uri: "/gone.ts", viewColumn: 1 },
        { uri: "/here.ts", viewColumn: 1 },
      ],
    },
  ]);
  __setPickHandler(async (items) => items[0]);
  ws.openTextDocument = async (uri: { fsPath: string }) => {
    if (uri.fsPath === "/gone.ts") {
      throw new Error("missing");
    }
    return { uri };
  };
  await restoreLayout(ctx as never);
  assert.deepEqual(__infoMessages(), ["Restored layout Mixed: opened 1, skipped 1 that no longer exist."]);
});

test("a layout with zero columns still creates one group, and dismissing the pick does nothing", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(KEY, [{ name: "Z", columns: 0, tabs: [] }]);
  await restoreLayout(ctx as never);
  assert.deepEqual(__recordedCommands(), []);
  __setPickHandler(async (items) => items[0]);
  await restoreLayout(ctx as never);
  assert.deepEqual(__recordedCommands()[0].args, [{ orientation: 0, groups: [{}] }]);
});

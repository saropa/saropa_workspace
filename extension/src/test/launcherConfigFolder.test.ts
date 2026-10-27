// Tests for the launcher's "Open Folder" flow: the recent list, the browse dialog and the
// project-root rule (a config in .saropa or .vscode opens its parent folder).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  Uri, __setPickHandler, __setOpenDialogHandler, __resetHandlers, __recordedCommands, __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { handleOpenFolder } from "../views/launcherConfigFolder";

const RECENT = "saropaWorkspace.recentConfigFiles";
const LAST = "saropaWorkspace.lastConfigFile";

beforeEach(() => {
  __resetHandlers();
  __resetRecordedCommands();
});
afterEach(() => {
  __resetHandlers();
  __resetRecordedCommands();
});

const opened = (): string[] =>
  __recordedCommands().filter((c) => c.command === "vscode.openFolder").map((c) => (c.args[0] as Uri).fsPath);

test("with no recent configs it goes straight to the browse dialog and offers json files only", async () => {
  const ctx = fakeContext();
  let seen: Record<string, unknown> | undefined;
  __setOpenDialogHandler(async (opts) => {
    seen = opts as unknown as Record<string, unknown>;
    return undefined;
  });
  let pickerShown = false;
  __setPickHandler(async () => {
    pickerShown = true;
    return undefined;
  });
  await handleOpenFolder(ctx);
  assert.equal(pickerShown, false);
  assert.equal(seen?.canSelectFiles, true);
  assert.equal(seen?.canSelectFolders, false);
  assert.equal(seen?.canSelectMany, false);
  assert.equal(seen?.defaultUri, undefined);
  assert.equal(seen?.title, "Select a workspace config file");
  assert.deepEqual(seen?.filters, { "JSON config files": ["json"] });
  assert.deepEqual(opened(), []);
});

test("a file picked in the dialog opens its folder and is remembered as recent and last", async () => {
  const ctx = fakeContext();
  __setOpenDialogHandler(async () => [Uri.file("/work/app/config.json")]);
  await handleOpenFolder(ctx);
  assert.deepEqual(opened(), ["/work/app"]);
  assert.deepEqual(ctx.globalState.get(RECENT), ["/work/app/config.json"]);
  assert.equal(ctx.globalState.get(LAST), "/work/app/config.json");
});

test("a config inside .saropa or .vscode opens the project folder above it", async () => {
  __setOpenDialogHandler(async () => [Uri.file("/work/app/.saropa/workspace.json")]);
  await handleOpenFolder(fakeContext());
  __setOpenDialogHandler(async () => [Uri.file("/work/other/.vscode/saropa.json")]);
  await handleOpenFolder(fakeContext());
  assert.deepEqual(opened(), ["/work/app", "/work/other"]);
});

test("a config inside some other folder opens that folder itself", async () => {
  const ctx = fakeContext();
  __setOpenDialogHandler(async () => [Uri.file("/work/app/settings/workspace.json")]);
  await handleOpenFolder(ctx);
  assert.deepEqual(opened(), ["/work/app/settings"]);
});

test("a canceled or empty dialog opens nothing and records nothing", async () => {
  const ctx = fakeContext();
  __setOpenDialogHandler(async () => undefined);
  await handleOpenFolder(ctx);
  __setOpenDialogHandler(async () => []);
  await handleOpenFolder(ctx);
  assert.deepEqual(opened(), []);
  assert.deepEqual(ctx.globalState.keys(), []);
});

test("the recent list is a picker of projects with a Browse row last", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(RECENT, ["/p/one/.saropa/a.json", "/p/two/b.json"]);
  let items: readonly unknown[] = [];
  let options: unknown;
  __setPickHandler(async (given, opts) => {
    items = given;
    options = opts;
    return undefined;
  });
  await handleOpenFolder(ctx);
  assert.deepEqual(items, [
    { label: "one", description: "/p/one", detail: "/p/one/.saropa/a.json" },
    { label: "two", description: "/p/two", detail: "/p/two/b.json" },
    { label: "Browse…", description: "", detail: "" },
  ]);
  assert.deepEqual(options, { placeHolder: "Pick a recent workspace or browse for a config file" });
  assert.deepEqual(opened(), []);
});

test("choosing a recent project opens it and moves it to the front without a duplicate", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(RECENT, ["/p/one/a.json", "/p/two/b.json", "/p/three/c.json"]);
  __setPickHandler(async (items) => items[1]);
  await handleOpenFolder(ctx);
  assert.deepEqual(opened(), ["/p/two"]);
  assert.deepEqual(ctx.globalState.get(RECENT), ["/p/two/b.json", "/p/one/a.json", "/p/three/c.json"]);
  assert.equal(ctx.globalState.get(LAST), "/p/two/b.json");
});

test("the recent list is capped at five, dropping the oldest", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(RECENT, ["/p/1/a.json", "/p/2/a.json", "/p/3/a.json", "/p/4/a.json", "/p/5/a.json"]);
  __setOpenDialogHandler(async () => [Uri.file("/p/6/a.json")]);
  __setPickHandler(async (items) => items[items.length - 1]);
  await handleOpenFolder(ctx);
  assert.deepEqual(ctx.globalState.get(RECENT), [
    "/p/6/a.json", "/p/1/a.json", "/p/2/a.json", "/p/3/a.json", "/p/4/a.json",
  ]);
});

test("choosing Browse starts the dialog in the project of the last config opened", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(RECENT, ["/p/one/.vscode/a.json"]);
  await ctx.globalState.update(LAST, "/p/one/.vscode/a.json");
  __setPickHandler(async (items) => items[items.length - 1]);
  let defaultUri: Uri | undefined;
  __setOpenDialogHandler(async (opts) => {
    defaultUri = opts?.defaultUri;
    return undefined;
  });
  await handleOpenFolder(ctx);
  assert.equal(defaultUri?.fsPath, "/p/one");
  assert.deepEqual(opened(), []);
});

test("dismissing the picker does nothing", async () => {
  const ctx = fakeContext();
  await ctx.globalState.update(RECENT, ["/p/one/a.json"]);
  __setPickHandler(async () => undefined);
  await handleOpenFolder(ctx);
  assert.deepEqual(opened(), []);
  assert.deepEqual(ctx.globalState.get(RECENT), ["/p/one/a.json"]);
});

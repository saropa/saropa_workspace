// Unit tests for the "add website shortcuts found in this project" command, run
// against a temp project with a real package.json homepage.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { scanProjectUrls } from "../commands/scanUrls";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

type StubVscode = typeof vscode & {
  __setWorkspaceFolders(f: vscode.WorkspaceFolder[] | undefined): void;
  __setPickHandler(h: (items: readonly unknown[]) => Promise<unknown>): void;
  __resetHandlers(): void;
};
const stub = vscode as StubVscode;
const win = vscode.window as unknown as Record<string, unknown>;
let origInfo: unknown;
let origWarn: unknown;
let info: string[];
let warn: string[];

beforeEach(() => {
  origInfo = win.showInformationMessage;
  origWarn = win.showWarningMessage;
  info = [];
  warn = [];
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showWarningMessage = (m: string): Promise<undefined> => (warn.push(m), Promise.resolve(undefined));
});

afterEach(() => {
  win.showInformationMessage = origInfo;
  win.showWarningMessage = origWarn;
  stub.__setWorkspaceFolders(undefined);
  stub.__resetHandlers();
});

function projectWithHomepage(homepage: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "urls-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ homepage }));
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "p", index: 0 }]);
}

function fakeStore(existing: Shortcut[] = [], accept = true) {
  const added: Array<{ url: string; label: string | undefined }> = [];
  const store = {
    getProjectShortcuts: () => existing,
    getGlobalShortcuts: () => [],
    addUrlShortcut: async (url: string, _scope: string, label?: string) => {
      added.push({ url, label });
      return accept;
    },
  } as unknown as ShortcutStore;
  return { store, added };
}

test("a project with no declared websites says so", async () => {
  stub.__setWorkspaceFolders(undefined);
  const { store, added } = fakeStore();
  await scanProjectUrls(store);
  assert.match(info[0], /No project websites found/);
  assert.deepEqual(added, []);
});

test("websites that are already shortcuts are not offered again", async () => {
  projectWithHomepage("https://example.com/app");
  const existing = [{ id: "u", path: "", scope: "project", action: { kind: "url", url: "https://example.com/app" } } as Shortcut];
  const { store, added } = fakeStore(existing);
  stub.__setPickHandler(async () => assert.fail("nothing should be offered"));
  await scanProjectUrls(store);
  assert.match(info[0], /already a shortcut/);
  assert.deepEqual(added, []);
});

test("picked websites are added and counted", async () => {
  projectWithHomepage("https://example.com/app");
  const { store, added } = fakeStore();
  let offered: Array<{ description?: string; picked?: boolean; candidate: { url: string } }> = [];
  stub.__setPickHandler(async (items) => {
    offered = items as typeof offered;
    return items;
  });
  await scanProjectUrls(store);
  assert.equal(offered.length, 1);
  assert.equal(offered[0].description, "https://example.com/app");
  assert.equal(offered[0].picked, true);
  assert.deepEqual(added.map((a) => a.url), ["https://example.com/app"]);
  assert.match(info[0], /Added 1 website shortcut/);
});

test("cancelling or picking nothing adds nothing and shows nothing", async () => {
  projectWithHomepage("https://example.com/app");
  const { store, added } = fakeStore();
  stub.__setPickHandler(async () => undefined);
  await scanProjectUrls(store);
  stub.__setPickHandler(async () => []);
  await scanProjectUrls(store);
  assert.deepEqual(added, []);
  assert.deepEqual(info, []);
  assert.deepEqual(warn, []);
});

test("when the store refuses every add the user is warned instead of told it worked", async () => {
  projectWithHomepage("https://example.com/app");
  const { store } = fakeStore([], false);
  stub.__setPickHandler(async (items) => items);
  await scanProjectUrls(store);
  assert.equal(warn.length, 1);
  assert.deepEqual(info, []);
});

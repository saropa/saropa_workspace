// Tests for tail-follow: pinning an editor to its last line, the shared listeners, and
// the toggle command.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __setInfoAnswer,
  __resetInfo,
  __openedDocuments,
  __resetOpenedDocuments,
  __setVisibleEditors,
  __fireHostEvent,
  __resetHosts,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { ShortcutStore } from "../model/shortcutStore";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import { startTailFollow, registerTailFollow, toggleTail } from "../commands/shortcutTailFollow";
import { showTextDocument, type FakeTextEditor } from "./_stub/vscodeEditor";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;

async function open(name: string, text: string): Promise<FakeTextEditor> {
  nodeFs.writeFileSync(`${dir}/${name}`, text);
  return showTextDocument(Uri.file(`${dir}/${name}`));
}

const lastReveal = (e: FakeTextEditor): [number, number] | undefined => {
  const r = e.reveals.at(-1)?.range;
  return r ? [r.start.line, r.start.character] : undefined;
};

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-tail-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetOpenedDocuments();
  __resetHosts();
  const ctx = fakeContext();
  tappedShortcuts.init(ctx as never);
  telemetry.init(ctx);
  store = new ShortcutStore(ctx);
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetOpenedDocuments();
  __resetHosts();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("starting a follow reveals the last character of the last line", async () => {
  const editor = await open("a.log", "one\ntwo\nlast!");
  startTailFollow(editor as never);
  assert.deepEqual(lastReveal(editor), [2, 5]);
  assert.equal(editor.reveals[0].type, 0);
});

test("a followed document that grows is re-pinned in every visible editor showing it", async () => {
  const ctx = registrarContext();
  registerTailFollow(ctx as never);
  const left = await open("b.log", "one");
  const right = await open("b.log", "one");
  const other = await open("c.log", "x");
  __setVisibleEditors([left, right, other]);
  startTailFollow(left as never);
  left.reveals.length = 0;
  __fireHostEvent("textChanged", { document: { uri: left.document.uri } });
  assert.equal(left.reveals.length, 1);
  assert.equal(right.reveals.length, 1);
  assert.equal(other.reveals.length, 0, "an unrelated editor is left alone");
  ctx.subscriptions.forEach((d) => d.dispose());
});

test("a change to a document that is not followed does nothing", async () => {
  const ctx = registrarContext();
  registerTailFollow(ctx as never);
  const editor = await open("d.log", "one");
  __setVisibleEditors([editor]);
  __fireHostEvent("textChanged", { document: { uri: editor.document.uri } });
  assert.equal(editor.reveals.length, 0);
  ctx.subscriptions.forEach((d) => d.dispose());
});

test("closing the tab stops the follow", async () => {
  const ctx = registrarContext();
  registerTailFollow(ctx as never);
  const editor = await open("e.log", "one");
  __setVisibleEditors([editor]);
  startTailFollow(editor as never);
  editor.reveals.length = 0;
  __fireHostEvent("textClosed", { uri: editor.document.uri });
  __fireHostEvent("textChanged", { document: { uri: editor.document.uri } });
  assert.equal(editor.reveals.length, 0);
  ctx.subscriptions.forEach((d) => d.dispose());
});

test("registering adds two listeners to the subscriptions and no commands", () => {
  const ctx = registrarContext();
  const ids = captureRegistrations(() => registerTailFollow(ctx as never));
  assert.deepEqual(ids, []);
  assert.equal(ctx.subscriptions.length, 2);
  ctx.subscriptions.forEach((d) => d.dispose());
});

async function stored(name: string): Promise<Shortcut> {
  nodeFs.writeFileSync(`${dir}/${name}`, "a\nb");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

test("toggling on a non-file shortcut warns and changes nothing", async () => {
  const site = { id: "u", scope: "global", path: "", order: 0, label: "Site", action: { kind: "url", url: "https://x.test" } } as unknown as Shortcut;
  await toggleTail(store, site);
  assert.deepEqual(__warningMessages(), ["Site is not a file shortcut; log follow applies to file shortcuts only."]);
});

test("turning follow on stores the flag and offers to open the file now", async () => {
  const file = await stored("f.log");
  await toggleTail(store, file);
  assert.equal(store.findShortcut(file.id)!.tailFollow, true);
  assert.deepEqual(__infoMessages(), ["Following f.log like tail -f. Opening it scrolls to new lines as the file grows."]);
  assert.deepEqual(__openedDocuments(), []);
});

test("choosing Open now opens the file already following", async () => {
  const file = await stored("g.log");
  __setInfoAnswer((_m, items) => items[0]);
  await toggleTail(store, file);
  assert.deepEqual(__openedDocuments(), [`${dir}/g.log`]);
});

test("turning follow off clears the flag and stops an open tab from following", async () => {
  const ctx = registrarContext();
  registerTailFollow(ctx as never);
  const file = await stored("h.log");
  await toggleTail(store, file);
  const editor = await open("h.log", "a\nb");
  __setVisibleEditors([editor]);
  startTailFollow(editor as never);
  const on = store.findShortcut(file.id)!;
  __resetInfo();
  await toggleTail(store, on);
  assert.equal(store.findShortcut(file.id)!.tailFollow, undefined);
  assert.deepEqual(__infoMessages(), ["Stopped following h.log."]);
  editor.reveals.length = 0;
  __fireHostEvent("textChanged", { document: { uri: Uri.file(`${dir}/h.log`) } });
  assert.equal(editor.reveals.length, 0);
  ctx.subscriptions.forEach((d) => d.dispose());
});

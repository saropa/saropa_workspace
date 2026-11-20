// Tests for the HubGrid panel: opening and reusing it, the debounced load, and the
// id-only open / copy / refresh messages. The panel is built through its real entry point
// (HubGridPanel.show) against a real store and a minimal engine double.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __lastWebviewPanel, __resetWebviewPanels, __externalOpens, __resetEnv, __clipboardWrites,
  __statusMessages, __resetStatusMessages, __recordedCommands, __resetRecordedCommands,
} from "./_stub/vscode";
import { EventEmitter } from "./_stub/vscodeTypes";
import { type FakeWebviewPanel } from "./_stub/vscodeWebview";
import { fakeContext } from "./_stub/context";
import { FolderWatchStore } from "../model/folderWatch";
import type { FolderWatchEngine } from "../exec/folderWatchEngine";
import type { GitHubWatchItem } from "../github/githubTypes";
import { HubGridPanel } from "../views/hubGridPanel";
import { settle, flushEvents } from "./settle";
import { l10n } from "../i18n/l10n";

const items: GitHubWatchItem[] = [
  { key: "issue:1", kind: "issue", number: 1, title: "First", htmlUrl: "https://github.com/o/r/issues/1", author: "a", updatedAt: "2026-01-02T00:00:00Z", labels: [] },
  { key: "pr:2", kind: "pr", number: 2, title: "Second", htmlUrl: "https://github.com/o/r/pull/2", author: "a", updatedAt: "2026-01-01T00:00:00Z", labels: [] },
];

let store: FolderWatchStore;
let scanned: EventEmitter<void>;
let refreshCalls: number;

const engine = (): FolderWatchEngine => ({
  getCachedRepoItems: (id: string) => (id === "r1" ? items : []),
  getRepoScanError: () => undefined,
  refreshRepoWatches: async () => { refreshCalls++; },
  onDidScanRepo: scanned.event,
}) as unknown as FolderWatchEngine;

const panel = (): FakeWebviewPanel => {
  const p = __lastWebviewPanel();
  assert.ok(p, "a panel exists");
  return p;
};
const posted = (): Array<Record<string, unknown>> => panel().webview.postedMessages as Array<Record<string, unknown>>;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);

beforeEach(async () => {
  store = new FolderWatchStore(fakeContext());
  scanned = new EventEmitter<void>();
  refreshCalls = 0;
  await store.add({ id: "r1", target: "o/r", kind: "repo", isFile: false, mode: "new", enabled: true });
  await store.addUnseen("r1", ["issue:1", "pr:2"]);
  HubGridPanel.show(store, engine());
});

afterEach(() => {
  __resetWebviewPanels();
  __resetEnv();
  __resetStatusMessages();
  __resetRecordedCommands();
});

test("show opens the panel with the Saropa-prefixed title and reuses it on a second call", () => {
  const first = panel();
  assert.equal(first.viewType, "saropaWorkspace.hubGrid");
  assert.equal(first.title, l10n("hubGrid.title"));
  assert.match(first.title, /^Saropa /);
  HubGridPanel.show(store, engine());
  assert.equal(panel(), first);
});

test("the shell carries a strict CSP, the grid role and no remote content", () => {
  const html = panel().webview.html;
  assert.match(html, /default-src 'none'/);
  assert.match(html, /role="grid"/);
  assert.doesNotMatch(html, /https?:\/\/(?!github\.com)/);
});

test("ready sends one load with the rows newest first and their unseen flags", async () => {
  send({ type: "ready" });
  await settle(() => posted().length === 1);
  const load = posted()[0] as { type: string; repos: string[]; rows: Array<{ number: number; unseen: boolean }> };
  assert.equal(load.type, "load");
  assert.deepEqual(load.repos, ["o/r"]);
  assert.deepEqual(load.rows.map((r) => [r.number, r.unseen]), [[1, true], [2, true]]);
});

test("a burst of change events collapses into a single load post", async () => {
  scanned.fire();
  scanned.fire();
  await store.addUnseen("r1", ["issue:9"]);
  scanned.fire();
  await settle(() => posted().length >= 1);
  await flushEvents(50);
  assert.equal(posted().length, 1);
});

test("open resolves the url from the cache, marks only that item seen and names it in the status bar", async () => {
  send({ type: "open", watchId: "r1", itemKey: "issue:1" });
  await settle(() => __externalOpens().length === 1);
  assert.deepEqual(__externalOpens(), ["https://github.com/o/r/issues/1"]);
  await settle(() => store.getUnseen("r1").length === 1);
  assert.deepEqual(store.getUnseen("r1"), ["pr:2"]);
  assert.deepEqual(__statusMessages(), [l10n("hubGrid.opened", { name: "#1 First" })]);
});

test("open for an item no longer cached opens nothing and says so", async () => {
  send({ type: "open", watchId: "r1", itemKey: "issue:404" });
  await settle(() => __statusMessages().length === 1);
  assert.deepEqual(__externalOpens(), []);
  assert.deepEqual(__statusMessages(), [l10n("hubGrid.itemGone")]);
});

test("a url sent by the page is ignored: only ids are honored", async () => {
  send({ type: "open", watchId: "r1", itemKey: "issue:1", htmlUrl: "https://evil.test/" });
  await settle(() => __externalOpens().length === 1);
  assert.deepEqual(__externalOpens(), ["https://github.com/o/r/issues/1"]);
});

test("messages with non-string ids or unknown types do nothing", async () => {
  send({ type: "open", watchId: 1, itemKey: {} });
  send({ type: "copy" });
  send({ type: "nope" });
  send(null);
  await flushEvents(30);
  assert.deepEqual(__externalOpens(), []);
  assert.deepEqual(__clipboardWrites(), []);
  assert.deepEqual(__statusMessages(), []);
});

test("copy writes the cached link to the clipboard and names the item", async () => {
  send({ type: "copy", watchId: "r1", itemKey: "pr:2" });
  await settle(() => __clipboardWrites().length === 1);
  assert.deepEqual(__clipboardWrites(), ["https://github.com/o/r/pull/2"]);
  await settle(() => __statusMessages().length === 1);
  assert.deepEqual(__statusMessages(), [l10n("hubGrid.copied", { name: "#2 Second" })]);
  assert.equal(store.getUnseen("r1").length, 2, "copying does not mark anything seen");
});

test("refresh asks the engine to poll the repo watches and then reloads", async () => {
  send({ type: "refresh" });
  await settle(() => refreshCalls === 1 && posted().length >= 1);
  assert.equal(refreshCalls, 1);
});

test("the empty-state button runs the add-a-repo-watch command", async () => {
  send({ type: "addWatch" });
  await settle(() => __recordedCommands().length === 1);
  assert.equal(__recordedCommands()[0].command,"saropaWorkspace.watchGitHubRepo");
});

test("disposing the panel stops repaints", async () => {
  const p = panel();
  p.dispose();
  const before = p.webview.postedMessages.length;
  scanned.fire();
  await flushEvents(30);
  assert.equal(p.webview.postedMessages.length, before);
});

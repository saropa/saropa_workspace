// Tests for the Mobile Remote Control panel host: the singleton, the message protocol
// (ready, search, refresh, run, pin) and what it posts back. adb itself is never needed:
// PATH is pointed at a temporary folder, empty or holding a small stand-in script.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  __lastWebviewPanel, __resetWebviewPanels, __resetHandlers, __warningMessages, __resetWarnings, __infoMessages,
  __resetInfo, type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle } from "./settle";
import { RemoteControlPanel, openRemoteControlPanel, OPEN_REMOTE_CONTROL_COMMAND } from "../views/remoteControl/remoteControlPanel";
import type { RemoteControlPayload } from "../views/remoteControl/remoteControlWire";
import { ShortcutStore } from "../model/shortcutStore";
import { adbRunHistory } from "../exec/adbRunHistory";
import { ADB_COMMAND_CATALOG } from "../model/adbCommandCatalog";
import { buildAndroidProjectProfile } from "../model/androidProjectProfile";
import { l10n } from "../i18n/l10n";

let binDir: string;
let originalPath: string | undefined;

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const catalogs = (): RemoteControlPayload[] =>
  panel().webview.postedMessages
    .filter((m): m is { type: string; payload: RemoteControlPayload } => (m as { type?: string }).type === "catalog")
    .map((m) => m.payload);
const send = (message: unknown): void => panel().webview.__receiveFromClient(message);
const writeAdb = (body: string): void => {
  const file = nodePath.join(binDir, "adb");
  nodeFs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  nodeFs.chmodSync(file, 0o755);
};

beforeEach(() => {
  __resetWebviewPanels();
  __resetHandlers();
  __resetWarnings();
  __resetInfo();
  adbRunHistory.init(fakeContext());
  binDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "sw-rcpanel-"));
  originalPath = process.env.PATH;
  process.env.PATH = binDir;
});

afterEach(() => {
  __lastWebviewPanel()?.dispose();
  __resetWebviewPanels();
  process.env.PATH = originalPath;
  nodeFs.rmSync(binDir, { recursive: true, force: true });
});

test("the open command id is the one package.json declares", () => {
  assert.equal(OPEN_REMOTE_CONTROL_COMMAND, "saropaWorkspace.openRemoteControl");
});

test("opening creates one scripted tab with the shell as its page", () => {
  RemoteControlPanel.show();
  assert.equal(panel().viewType, "saropaWorkspace.remoteControl");
  assert.equal(panel().title, l10n("remoteControl.title"));
  assert.match(panel().webview.html, /<html/i);
});

test("opening again reuses the tab; closing it lets a new one be made", () => {
  RemoteControlPanel.show();
  const first = panel();
  openRemoteControlPanel();
  assert.equal(panel(), first);
  first.dispose();
  RemoteControlPanel.show();
  assert.notEqual(panel(), first);
});

test("the ready message posts the full catalog, then again with the adb state", async () => {
  RemoteControlPanel.show();
  send({ type: "ready" });
  await settle(() => catalogs().length >= 2);
  const [first, second] = catalogs();
  assert.equal(first.total, ADB_COMMAND_CATALOG.length);
  assert.equal(first.shown, ADB_COMMAND_CATALOG.length);
  assert.equal(first.adb, undefined);
  assert.equal(second.adb?.available, false);
  assert.equal(second.adb?.status, l10n("remoteControl.adb.missing"));
});

test("a project profile passed in reaches the header chip", async () => {
  const profile = buildAndroidProjectProfile({
    hasAndroidDir: true,
    gradleText: `android { defaultConfig { applicationId "com.example.app" } }`,
  });
  RemoteControlPanel.show(undefined, profile);
  send({ type: "ready" });
  await settle(() => catalogs().length >= 2);
  assert.equal(catalogs()[0].project?.applicationId, "com.example.app");
});

test("without a profile the ready message reads one from the first workspace folder", async () => {
  const fx: FsFixture = createFsFixture("sw-rcpanel-ws-");
  try {
    fx.write("android/app/build.gradle", `android { defaultConfig { applicationId "com.example.fromdisk" } }`);
    RemoteControlPanel.show();
    send({ type: "ready" });
    await settle(() => catalogs().length >= 2);
    assert.equal(catalogs()[0].project?.applicationId, "com.example.fromdisk");
  } finally {
    fx.remove();
  }
});

test("searching narrows the list (tags count) and keeps the query for later posts", async () => {
  RemoteControlPanel.show();
  send({ type: "search", query: "wipe" });
  await settle(() => catalogs().length >= 1);
  const [result] = catalogs();
  assert.equal(result.query, "wipe");
  assert.ok(result.shown > 0 && result.shown < result.total);
  assert.ok(result.groups.flatMap((g) => g.commands).length === result.shown);
  send({ type: "refreshAdb" });
  await settle(() => catalogs().length >= 2);
  assert.equal(catalogs()[1].query, "wipe");
  assert.equal(catalogs()[1].shown, result.shown);
});

test("a search without text, or with a non-text query, shows everything", async () => {
  RemoteControlPanel.show();
  send({ type: "search", query: 7 });
  await settle(() => catalogs().length >= 1);
  assert.equal(catalogs()[0].query, "");
  assert.equal(catalogs()[0].shown, catalogs()[0].total);
});

test("a search that matches nothing posts an empty list, not nothing", async () => {
  RemoteControlPanel.show();
  send({ type: "search", query: "zzz-no-such-command" });
  await settle(() => catalogs().length >= 1);
  assert.deepEqual([catalogs()[0].shown, catalogs()[0].groups], [0, []]);
});

test("a refresh with adb present reports the attached device", { skip: process.platform === "win32" }, async () => {
  writeAdb('printf "List of devices attached\\nemulator-5554\\tdevice\\n"');
  RemoteControlPanel.show();
  send({ type: "refreshAdb" });
  await settle(() => catalogs().length >= 1);
  const adb = catalogs()[0].adb!;
  assert.deepEqual([adb.available, adb.tone, adb.status.startsWith(l10n("remoteControl.adb.oneDevice"))], [true, "ok", true]);
});

test("a refresh with adb present but failing reports that adb did not answer", { skip: process.platform === "win32" }, async () => {
  writeAdb("exit 1");
  RemoteControlPanel.show();
  send({ type: "refreshAdb" });
  await settle(() => catalogs().length >= 1);
  assert.deepEqual([catalogs()[0].adb?.status, catalogs()[0].adb?.tone], [l10n("remoteControl.adb.failed"), "warn"]);
});

test("pinning without a store warns and adds nothing", async () => {
  RemoteControlPanel.show();
  send({ type: "pin", id: ADB_COMMAND_CATALOG[0].id });
  await settle(() => __warningMessages().length > 0);
  assert.deepEqual([...__warningMessages()], [l10n("remoteControl.pin.noStore")]);
});

test("pinning with a store adds the command as a shell shortcut", async () => {
  const fx: FsFixture = createFsFixture("sw-rcpanel-pin-");
  try {
    const store = new ShortcutStore(fakeContext());
    await store.init();
    const entry = ADB_COMMAND_CATALOG[0];
    RemoteControlPanel.show(store);
    send({ type: "pin", id: entry.id });
    const name = l10n(entry.labelKey);
    await settle(() => __infoMessages().length > 0);
    assert.deepEqual([...__infoMessages()], [l10n("remoteControl.pin.addedProject", { name })]);
    const pinned = store.getProjectShortcuts().find((s) => s.label === name);
    assert.equal(pinned?.action?.kind, "shell");
  } finally {
    fx.remove();
  }
});

test("a store handed to an open tab replaces the earlier one", async () => {
  const fx: FsFixture = createFsFixture("sw-rcpanel-repoint-");
  try {
    RemoteControlPanel.show();
    const store = new ShortcutStore(fakeContext());
    await store.init();
    RemoteControlPanel.show(store);
    send({ type: "pin", id: ADB_COMMAND_CATALOG[0].id });
    await settle(() => __infoMessages().length > 0);
    assert.equal(__warningMessages().length, 0);
  } finally {
    fx.remove();
  }
});

test("running a command and declining it records nothing and refreshes the list", async () => {
  const entry = ADB_COMMAND_CATALOG.find((e) => !/\{[a-z]+\}/i.test(e.commandTemplate))!;
  RemoteControlPanel.show();
  send({ type: "run", id: entry.id });
  await settle(() => catalogs().length >= 2);
  assert.deepEqual(adbRunHistory.recent(), []);
  assert.ok(__infoMessages().some((m) => m === l10n("remoteControl.run.canceled", { name: l10n(entry.labelKey) })));
});

test("junk and unknown message types post nothing", async () => {
  RemoteControlPanel.show();
  for (const junk of [{ type: "run" }, { type: "pin" }, { type: "pin", id: 5 }, null, "text", { type: "mystery" }]) {
    send(junk);
  }
  send({ type: "search", query: "x" });
  await settle(() => catalogs().length >= 1);
  assert.equal(catalogs().length, 1);
  assert.equal(catalogs()[0].query, "x");
  assert.equal(__warningMessages().length, 0);
});

test("running an id the catalog does not have changes no history", async () => {
  RemoteControlPanel.show();
  send({ type: "run", id: "no-such-command" });
  await settle(() => catalogs().length >= 2);
  assert.deepEqual(adbRunHistory.recent(), []);
  assert.equal(__infoMessages().length, 0);
});

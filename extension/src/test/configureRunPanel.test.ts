// Tests for the Configure Run panel host: the single panel, the ready handshake (stored
// config as the wire form, detected interpreters), the live preview, the save round trip
// through the store, and the browse and cancel messages. PATH points at a temporary folder
// holding stand-in interpreters, so no real interpreter is needed.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __setWorkspaceFolders, __setConfig, __resetConfig, __setOpenDialogHandler, __resetHandlers, __resetWarnings,
  __warningMessages, __infoMessages, __resetInfo, __lastWebviewPanel, __resetWebviewPanels, type FakeWebviewPanel,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { settle, flushEvents } from "./settle";
import { ShortcutStore } from "../model/shortcutStore";
import { ConfigureRunPanel } from "../views/configureRunPanel";
import { clearInterpreterCache } from "../exec/interpreterDetect";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let binDir: string;
let store: ShortcutStore;
let originalPath: string | undefined;

const panel = (): FakeWebviewPanel => __lastWebviewPanel()!;
const posted = (): Array<Record<string, unknown>> => panel().webview.postedMessages as Array<Record<string, unknown>>;
const send = (m: unknown): void => panel().webview.__receiveFromClient(m);
const ofType = (type: string): Array<Record<string, unknown>> => posted().filter((m) => m.type === type);

async function stored(name: string): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}
const fresh = (id: string): Shortcut => store.findShortcut(id)!;
const wire = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: undefined, argsLine: "", cwd: undefined, env: {}, location: undefined, elevated: false, includeFilePath: true,
  extractResult: undefined, dependsOn: undefined, sound: "default", runOnSave: false, allowConcurrent: false, lockName: undefined, ...over,
});

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-crpanel-")).replace(/\\/g, "/");
  binDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-crbin-"));
  originalPath = process.env.PATH;
  process.env.PATH = binDir;
  clearInterpreterCache();
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings(); __resetInfo(); __resetHandlers(); __resetWebviewPanels();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __resetWebviewPanels();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetHandlers();
  process.env.PATH = originalPath;
  clearInterpreterCache();
  nodeFs.rmSync(dir, { recursive: true, force: true });
  nodeFs.rmSync(binDir, { recursive: true, force: true });
});

test("an auto shortcut cannot be configured: a warning, no panel", () => {
  const auto = store.getProjectShortcuts().find((p) => p.isAuto)!;
  ConfigureRunPanel.show(fakeContext(), store, auto);
  assert.deepEqual(__warningMessages(), ["Run parameters cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
  assert.equal(__lastWebviewPanel(), undefined);
});

test("show opens one scripted panel titled with the shortcut name and filled with the form", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  assert.equal(panel().viewType, "saropaWorkspace.configureRun");
  assert.equal(panel().title, "Saropa Run: run.sh");
  assert.match(panel().webview.html, /<h1>Saropa Run: run\.sh<\/h1>/);
});

test("showing again for another shortcut reuses the panel and rebuilds it", async () => {
  const a = await stored("a.sh");
  const b = await stored("b.sh");
  ConfigureRunPanel.show(fakeContext(), store, a);
  const first = panel();
  ConfigureRunPanel.show(fakeContext(), store, b);
  assert.equal(panel(), first);
  assert.equal(first.title, "Saropa Run: b.sh");
  assert.match(first.webview.html, /<h1>Saropa Run: b\.sh<\/h1>/);
  send({ type: "ready" });
  await settle(() => ofType("init").length === 1);
  send({ type: "save", work: wire({ command: "node" }) });
  await settle(() => first.disposed);
  assert.equal(fresh(b.id).exec?.command, "node");
  assert.equal(fresh(a.id).exec?.command, undefined);
});

test("closing the panel lets the next show create a new one", async () => {
  const sc = await stored("a.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  const first = panel();
  first.dispose();
  ConfigureRunPanel.show(fakeContext(), store, sc);
  assert.notEqual(panel(), first);
});

test("ready for a shortcut with no stored config posts the defaults", async () => {
  const sc = await stored("plain.txt");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "ready" });
  await settle(() => ofType("init").length === 1);
  assert.deepEqual(ofType("init")[0], {
    type: "init",
    work: {
      command: undefined, argsLine: "", cwd: undefined, env: {}, location: undefined, elevated: false, includeFilePath: true,
      extractResult: undefined, dependsOn: undefined, sound: "default", runOnSave: false, allowConcurrent: false, lockName: undefined,
    },
  });
});

test("ready posts the stored config in the wire form", async () => {
  const sc = await stored("run.sh");
  await store.updateShortcutExec(sc, {
    command: "bash -x", args: ["--name", "a b"], cwd: "/tmp", env: { K: "v" }, runLocation: "external", elevated: true,
    includeFilePath: false, extractResult: "id=(\\d+)", dependsOn: "other", sound: "off", runOnSave: true,
  });
  await store.setShortcutConcurrency(fresh(sc.id), true, "lock-1");
  ConfigureRunPanel.show(fakeContext(), store, fresh(sc.id));
  send({ type: "ready" });
  await settle(() => ofType("init").length === 1);
  assert.deepEqual((ofType("init")[0] as { work: unknown }).work, {
    command: "bash -x", argsLine: '--name "a b"', cwd: "/tmp", env: { K: "v" }, location: "external", elevated: true,
    includeFilePath: false, extractResult: "id=(\\d+)", dependsOn: "other", sound: "off", runOnSave: true,
    allowConcurrent: true, lockName: "lock-1",
  });
});

test("ready also posts the interpreters found on PATH and the hint for a blank command", async () => {
  nodeFs.writeFileSync(nodePath.join(binDir, "bash"), "#!/bin/sh\n", { mode: 0o755 });
  __setConfig("saropaWorkspace", "interpreterDefaults", { ".sh": "bash" });
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "ready" });
  await settle(() => ofType("interpreters").length === 1);
  const msg = ofType("interpreters")[0] as { detected: unknown[]; labels: Record<string, string> };
  assert.deepEqual(msg.detected, [{ label: "bash", command: "bash", detail: nodePath.join(binDir, "bash") }]);
  assert.equal(msg.labels.useDefault, "Default");
  assert.equal(msg.labels.browse, "Browse…");
  assert.equal(msg.labels.defaultHint, "Empty runs with bash, the default for this file type.");
});

test("for a file type with no interpreter the chips are empty and the hint says it opens the file", async () => {
  const sc = await stored("notes.txt");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "ready" });
  await settle(() => ofType("interpreters").length === 1);
  const msg = ofType("interpreters")[0] as { detected: unknown[]; labels: Record<string, string> };
  assert.deepEqual(msg.detected, []);
  assert.equal(msg.labels.defaultHint, "Empty opens the file — its type has no interpreter.");
});

test("ready after the shortcut was removed posts nothing", async () => {
  const sc = await stored("gone.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  await store.removeShortcut(sc);
  send({ type: "ready" });
  await flushEvents();
  assert.deepEqual(posted(), []);
});

test("a change message answers with the real command line and that the pattern is valid", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "change", work: wire({ command: "bash -x", argsLine: '--flag "a b"', extractResult: "ok" }) });
  await settle(() => ofType("preview").length === 1);
  assert.deepEqual(ofType("preview")[0], {
    type: "preview",
    commandLine: `bash -x ${dir}/run.sh --flag "a b"`,
    extractValid: true,
  });
});

test("the preview leaves out the file when the file argument is off, and marks an external administrator run", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "change", work: wire({ command: "make", includeFilePath: false, location: "external", elevated: true }) });
  await settle(() => ofType("preview").length === 1);
  assert.equal(ofType("preview")[0].commandLine, "make — as administrator");
});

test("the preview says the file is opened when the type has no run command", async () => {
  const sc = await stored("notes.txt");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "change", work: wire() });
  await settle(() => ofType("preview").length === 1);
  assert.equal(ofType("preview")[0].commandLine, "Opens the file (no run command for this file type).");
});

test("a malformed extract pattern is reported invalid, and a blank one is valid", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "change", work: wire({ command: "bash", extractResult: "(" }) });
  send({ type: "change", work: wire({ command: "bash", extractResult: "   " }) });
  await settle(() => ofType("preview").length === 2);
  assert.deepEqual(ofType("preview").map((m) => m.extractValid), [false, true]);
});

test("a change or save message without a work form does nothing", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "change" });
  send({ type: "save" });
  for (const m of [null, "save", 5, { type: "nope" }]) {
    send(m);
  }
  await flushEvents();
  assert.deepEqual(posted(), []);
  assert.equal(panel().disposed, false);
  assert.deepEqual(__infoMessages(), []);
});

test("a change for a removed shortcut posts no preview", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  await store.removeShortcut(sc);
  send({ type: "change", work: wire() });
  await flushEvents();
  assert.deepEqual(ofType("preview"), []);
});

test("save stores the normalized config and the concurrency settings, tells the user and closes", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({
    type: "save",
    work: wire({
      command: "bash", argsLine: '-e "a b"', cwd: "/work", env: { A: "1" }, location: "external", elevated: true,
      includeFilePath: false, extractResult: "x", dependsOn: "dep", sound: "on", runOnSave: true, allowConcurrent: true, lockName: "L",
    }),
  });
  await settle(() => panel().disposed);
  const saved = fresh(sc.id);
  assert.deepEqual(saved.exec, {
    command: "bash", args: ["-e", "a b"], cwd: "/work", env: { A: "1" }, runLocation: "external", elevated: true,
    includeFilePath: false, extractResult: "x", dependsOn: "dep", sound: "on", runOnSave: true,
  });
  assert.equal(saved.allowConcurrent, true);
  assert.equal(saved.lockName, "L");
  assert.deepEqual(__infoMessages(), ["Saved run parameters for run.sh."]);
});

test("saving the defaults collapses to an empty config so it matches hand-written JSON", async () => {
  const sc = await stored("run.sh");
  await store.updateShortcutExec(sc, { command: "node", args: ["x"], elevated: undefined, runOnSave: true });
  ConfigureRunPanel.show(fakeContext(), store, fresh(sc.id));
  send({ type: "save", work: wire() });
  await settle(() => panel().disposed);
  const saved = fresh(sc.id).exec ?? {};
  for (const key of ["command", "args", "cwd", "env", "runLocation", "elevated", "includeFilePath", "extractResult", "dependsOn", "sound", "runOnSave"]) {
    assert.equal((saved as Record<string, unknown>)[key], undefined, key);
  }
});

test("an administrator flag is dropped when the location is not external", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "save", work: wire({ command: "bash", location: "terminal", elevated: true }) });
  await settle(() => panel().disposed);
  assert.equal(fresh(sc.id).exec?.runLocation, "terminal");
  assert.equal(fresh(sc.id).exec?.elevated, undefined);
});

test("saving for a shortcut removed in the meantime warns and closes without a success toast", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  await store.removeShortcut(sc);
  send({ type: "save", work: wire({ command: "bash" }) });
  await settle(() => panel().disposed);
  assert.deepEqual(__warningMessages(), ["Run parameters cannot be set on an auto-shortcut. Add the file as a shortcut explicitly first."]);
  assert.deepEqual(__infoMessages(), []);
});

test("cancel closes the panel without saving", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  send({ type: "cancel" });
  assert.equal(panel().disposed, true);
  assert.equal(fresh(sc.id).exec?.command, undefined);
  assert.deepEqual(__infoMessages(), []);
});

test("browse hands the chosen executable back, quoted when its path has spaces", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  let seen: { title?: string; openLabel?: string; canSelectMany?: boolean } | undefined;
  __setOpenDialogHandler(async (opts) => { seen = opts; return [Uri.file("/opt/py thon/bin/python")]; });
  send({ type: "browse" });
  await settle(() => ofType("browsed").length === 1);
  assert.deepEqual(ofType("browsed")[0], { type: "browsed", command: '"/opt/py thon/bin/python"' });
  assert.equal(seen?.canSelectMany, false);
  __setOpenDialogHandler(async () => [Uri.file("/usr/bin/python3")]);
  send({ type: "browse" });
  await settle(() => ofType("browsed").length === 2);
  assert.deepEqual(ofType("browsed")[1], { type: "browsed", command: "/usr/bin/python3" });
});

test("a canceled browse dialog posts nothing", async () => {
  const sc = await stored("run.sh");
  ConfigureRunPanel.show(fakeContext(), store, sc);
  __setOpenDialogHandler(async () => undefined);
  send({ type: "browse" });
  __setOpenDialogHandler(async () => []);
  send({ type: "browse" });
  await flushEvents();
  assert.deepEqual(ofType("browsed"), []);
});

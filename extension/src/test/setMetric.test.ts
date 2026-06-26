// Live-metric badge editor tests (roadmap #24). setMetric is a settable-handler
// command: a QuickPick chooses the metric kind, and for the size kind an input box
// supplies an optional threshold. The store is the REAL ShortcutStore (fs-backed shim
// against a temp dir), so each test drives the dialog handlers to simulate the user
// and then asserts the persisted shortcut.metric the engine would read.
//
// Two guard paths need no dialog (and so no handler): an auto-shortcut and a non-file
// action shortcut are rejected up front, because neither has a single file to measure.
// The kind/threshold paths exercise the QuickPick -> input-box -> store.setShortcutMetric
// chain, including the size-threshold parse (parseSize) reached only via this flow.

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
  __setInputHandler,
  __setPickHandler,
  __resetHandlers,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { setMetric } from "../commands/setMetric";
import type { Shortcut } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

// The store types its uri arguments as the real vscode.Uri; the stub models the
// slice the store uses, so cast at the call site to satisfy tsc on the faithful stub.
const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __resetHandlers();
  // Skip recipe detection so init/refresh exercises only store IO, not the recipe
  // graph (mirrors the shortcutStore / branch-set tests).
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-metric-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetHandlers();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// A store holding a single project file shortcut (bundle.js). Returns the live stored
// shortcut so a test reads its metric back after setMetric persists it.
async function storeWithFileShortcut(): Promise<{ store: ShortcutStore; shortcut: Shortcut }> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "bundle.js")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "bundle.js");
  assert.ok(shortcut, "the added file pin should be present");
  return { store, shortcut };
}

// Read the persisted shortcut back from the store (setMetric mutates the STORED shortcut, not
// the copy it was handed), so assertions see what the metric engine would read.
function reread(store: ShortcutStore, id: string): Shortcut {
  const shortcut = store.findShortcut(id);
  assert.ok(shortcut, "the pin should still resolve after the mutation");
  return shortcut;
}

test("an auto-pin is rejected before any dialog, leaving no metric", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  // An auto-shortcut is recomputed each refresh and never stored, so a metric has nowhere
  // to live; the command must bail at the guard. Any dialog here would be a failure,
  // so the handlers stay at their "cancel everything" default.
  let dialogOpened = false;
  __setPickHandler(async () => {
    dialogOpened = true;
    return undefined;
  });
  await setMetric(store, { ...shortcut, isAuto: true });
  assert.equal(dialogOpened, false, "the guard must return before opening the picker");
  assert.equal(reread(store, shortcut.id).metric, undefined);
});

test("a non-file action pin is rejected (nothing to measure)", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  let dialogOpened = false;
  __setPickHandler(async () => {
    dialogOpened = true;
    return undefined;
  });
  // A shell recipe has no single file on disk, so the file-only guard must fire.
  await setMetric(store, { ...shortcut, action: { kind: "shell", shellCommand: "npm test" } });
  assert.equal(dialogOpened, false, "the file-only guard must return before the picker");
  assert.equal(reread(store, shortcut.id).metric, undefined);
});

test("choosing the lines metric persists { kind: 'lines' } with no threshold", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  // The QuickPick returns the line-count item; line count has no byte ceiling, so no
  // input box is shown and the stored metric is just the kind.
  __setPickHandler(async (items) => {
    const list = items as unknown as Array<{ value: string }>;
    return list.find((i) => i.value === "lines");
  });
  // An input box appearing here would mean the size-only threshold step leaked into
  // the lines path — fail if it is reached.
  __setInputHandler(async () => {
    throw new Error("the lines metric must not prompt for a threshold");
  });
  await setMetric(store, shortcut);
  assert.deepEqual(reread(store, shortcut.id).metric, { kind: "lines" });
});

test("choosing size with a threshold parses and stores thresholdBytes", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  __setPickHandler(async (items) => {
    const list = items as unknown as Array<{ value: string }>;
    return list.find((i) => i.value === "size");
  });
  // "250 KB" must parse to 250 * 1024 bytes via parseSize, the path reached only
  // through this size-threshold step.
  __setInputHandler(async () => "250 KB");
  await setMetric(store, shortcut);
  assert.deepEqual(reread(store, shortcut.id).metric, {
    kind: "size",
    thresholdBytes: 250 * 1024,
  });
});

test("size with a blank threshold stores a badge-only size metric", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  __setPickHandler(async (items) => {
    const list = items as unknown as Array<{ value: string }>;
    return list.find((i) => i.value === "size");
  });
  // An empty threshold means "badge only" — the metric is stored without a ceiling.
  __setInputHandler(async () => "");
  await setMetric(store, shortcut);
  assert.deepEqual(reread(store, shortcut.id).metric, { kind: "size" });
});

test("canceling the threshold input box aborts without writing", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  // Seed a metric first, then cancel the size-threshold step: the abort must leave
  // the existing metric untouched (Esc writes nothing).
  await store.setShortcutMetric(shortcut, { kind: "lines" });
  __setPickHandler(async (items) => {
    const list = items as unknown as Array<{ value: string }>;
    return list.find((i) => i.value === "size");
  });
  __setInputHandler(async () => undefined); // Esc on the threshold step
  await setMetric(store, reread(store, shortcut.id));
  assert.deepEqual(
    reread(store, shortcut.id).metric,
    { kind: "lines" },
    "a canceled threshold step must not overwrite the prior metric"
  );
});

test("choosing Off clears the metric", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  await store.setShortcutMetric(shortcut, { kind: "size", thresholdBytes: 1024 });
  __setPickHandler(async (items) => {
    const list = items as unknown as Array<{ value: string }>;
    return list.find((i) => i.value === "off");
  });
  await setMetric(store, reread(store, shortcut.id));
  assert.equal(reread(store, shortcut.id).metric, undefined, "Off must clear the metric");
});

test("dismissing the kind picker leaves the metric unchanged", async () => {
  const { store, shortcut } = await storeWithFileShortcut();
  await store.setShortcutMetric(shortcut, { kind: "modified" });
  // Esc on the kind picker (default handler returns undefined) must be a no-op.
  await setMetric(store, reread(store, shortcut.id));
  assert.deepEqual(reread(store, shortcut.id).metric, { kind: "modified" });
});

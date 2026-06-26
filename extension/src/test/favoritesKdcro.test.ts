// Mapping tests for the kdcro101 `.favorites.json` importer (roadmap 1.1 — the
// group-import slice). These run the REAL importer against the REAL PinStore: the
// fs-backed vscode stub persists the project file to a temp directory, so File ->
// pin, Group -> pin group, parent_id -> membership, the Directory/path-less skip
// path, and idempotency on re-run all execute end to end. Only the host SHELL (the
// vscode API surface) is faked. The OutputChannel is a line collector so skip
// reporting can be asserted without a real channel.

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
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { PinStore } from "../model/pinStore";
import { importKdcro } from "../import/favoritesKdcroBookmarks";
import type { OutputChannel } from "vscode";

// A line-collecting OutputChannel: the importer only ever calls appendLine, so the
// rest of the channel surface is cast away.
function fakeChannel(): { channel: OutputChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = {
    appendLine: (m: string): void => {
      lines.push(m);
    },
  } as unknown as OutputChannel;
  return { channel, lines };
}

let tmpDir: string;
let folder: WorkspaceFolder;

// kdcro stores absolute fsPaths; build them under the temp folder so the store's
// getWorkspaceFolder prefix match resolves them as project pins.
const abs = (rel: string): string => `${tmpDir}/${rel}`;

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO (mirrors the store
  // test setup); recipes have their own pure detector tests.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-kdcro-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("File entries become pins; a Group entry becomes a pin group with its members", async () => {
  const store = new PinStore(fakeContext());
  await store.init();

  // A Group container, one File inside it (parent_id -> group), and one top-level
  // File with no parent.
  const json = JSON.stringify([
    { type: "Group", id: "g1", name: "Backend" },
    { type: "File", fsPath: abs("api/server.ts"), parent_id: "g1" },
    { type: "File", fsPath: abs("README.md") },
  ]);
  const { channel } = fakeChannel();

  const result = await importKdcro(json, ".favorites.json", store, channel);

  assert.equal(result.added, 2, "both File entries import");
  assert.equal(result.skipped, 0, "no entry is skipped");

  const groups = store.getProjectGroups();
  assert.equal(groups.length, 1, "the Group entry creates exactly one pin group");
  assert.equal(groups[0].label, "Backend");

  const grouped = store.getProjectPins().find((p) => p.path === "api/server.ts");
  const topLevel = store.getProjectPins().find((p) => p.path === "README.md");
  assert.ok(grouped, "the grouped file is pinned");
  assert.ok(topLevel, "the top-level file is pinned");
  assert.equal(
    grouped!.groupId,
    groups[0].id,
    "the grouped file's pin carries the group's id"
  );
  assert.equal(
    topLevel!.groupId,
    undefined,
    "the unparented file stays at the top level"
  );
});

test("a Directory entry and a path-less entry are reported and skipped", async () => {
  const store = new PinStore(fakeContext());
  await store.init();

  const json = JSON.stringify([
    { type: "Directory", name: "assets", fsPath: abs("assets") },
    { type: "File", name: "no path here" },
    { type: "File", fsPath: abs("main.ts") },
  ]);
  const { channel, lines } = fakeChannel();

  const result = await importKdcro(json, ".favorites.json", store, channel);

  assert.equal(result.added, 1, "only the valid File imports");
  assert.equal(result.skipped, 2, "the Directory and the path-less File are skipped");
  assert.equal(
    store.getProjectGroups().length,
    0,
    "a Directory does not create a pin group"
  );
  // Each skip is reported to the channel (the no-silent-drop contract).
  assert.equal(lines.length, 2, "both skips are logged");
});

test("re-importing the same file adds no duplicate pins or groups (idempotent)", async () => {
  const context = fakeContext();
  const store = new PinStore(context);
  await store.init();

  const json = JSON.stringify([
    { type: "Group", id: "g1", name: "Docs" },
    { type: "File", fsPath: abs("docs/intro.md"), parent_id: "g1" },
  ]);
  const { channel } = fakeChannel();

  const first = await importKdcro(json, ".favorites.json", store, channel);
  assert.equal(first.added, 1);

  // Second pass over the identical source: the pin dedupes by path and the group
  // is reused by name, so nothing new is created.
  const second = await importKdcro(json, ".favorites.json", store, channel);
  assert.equal(second.added, 0, "the second import adds no pin");

  assert.equal(
    store.getProjectPins().filter((p) => p.path === "docs/intro.md").length,
    1,
    "the pin exists exactly once"
  );
  assert.equal(
    store.getProjectGroups().filter((g) => g.label === "Docs").length,
    1,
    "the group exists exactly once"
  );
});

test("a malformed file imports nothing, logs the error, and does not throw", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const { channel, lines } = fakeChannel();

  const result = await importKdcro("{ not valid json", ".favorites.json", store, channel);

  assert.deepEqual(result, { added: 0, skipped: 0 });
  // The store synthesizes a config-example pin on init, so assert on what the
  // import itself produced: no group, and nothing added.
  assert.equal(store.getProjectGroups().length, 0, "no group is created");
  assert.equal(lines.length, 1, "the parse failure is reported once");
});

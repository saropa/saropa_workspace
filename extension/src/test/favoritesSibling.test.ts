// Import tests for the cross-project sibling scan (importSiblingFavorites). A
// sibling's favorite is an absolute path outside the open workspace folder, so it
// can only become a GLOBAL shortcut; this file exercises that resolve-and-add path
// against the REAL ShortcutStore via the fs-backed vscode stub: a kdcro `.favorites.json`
// (absolute fsPath File entries, Group/Directory entries filtered out), our own
// `.vscode/saropa-workspace.json` (paths relative to the sibling folder), a malformed
// file (imports nothing), and dedup on re-run (the store dedupes by absolute path).
//
// detectSiblingFavorites is NOT exercised here: it walks parent directories via
// workspace.fs.readDirectory, which the unit stub does not model, so the detector
// always returns nothing under the stub. importSiblingFavorites takes the detected
// descriptor as a parameter, so its resolve-and-add logic is fully testable.

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
import { ShortcutStore } from "../model/shortcutStore";
import {
  importSiblingFavorites,
  type SiblingFavorites,
} from "../import/favoritesSibling";

let tmpDir: string;
let folder: WorkspaceFolder;
let siblingDirPath: string;

// Build a sibling descriptor pointing at a file written under the sibling folder.
// `format` selects how its entries are resolved (kdcro absolute vs saropa relative).
function sibling(format: "kdcro" | "saropa", relPath: string): SiblingFavorites {
  return {
    siblingDir: Uri.file(siblingDirPath),
    siblingName: "neighbor",
    fileUri: Uri.file(`${siblingDirPath}/${relPath}`),
    fileLabel: relPath,
    format,
  } as unknown as SiblingFavorites;
}

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  // The OPEN folder (its pins are project-scoped); the sibling lives beside it and is
  // NOT an open folder, so its favorites become global pins.
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-sibling-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(`${tmpDir}/open`), name: "open", index: 0 };
  nodeFs.mkdirSync(folder.uri.fsPath, { recursive: true });
  siblingDirPath = `${tmpDir}/neighbor`;
  nodeFs.mkdirSync(`${siblingDirPath}/.vscode`, { recursive: true });
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a kdcro sibling file imports its absolute-path File entries as global pins", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  // kdcro stores absolute fsPaths. A Group and a Directory entry are NOT files, so
  // they are filtered out — only the two File entries resolve to pins.
  nodeFs.writeFileSync(
    `${siblingDirPath}/.favorites.json`,
    JSON.stringify([
      { type: "Group", id: "g1", name: "Backend" },
      { type: "File", fsPath: `${siblingDirPath}/api/server.ts` },
      { type: "Directory", fsPath: `${siblingDirPath}/assets` },
      { type: "File", fsPath: `${siblingDirPath}/README.md` },
    ])
  );

  const added = await importSiblingFavorites(sibling("kdcro", ".favorites.json"), store);

  assert.equal(added, 2, "only the two File entries import (Group and Directory are skipped)");
  // A sibling favorite is outside the open folder, so it is a GLOBAL shortcut storing the
  // absolute path.
  const globalPaths = store.getGlobalShortcuts().map((p) => p.path.replace(/\\/g, "/"));
  assert.ok(
    globalPaths.includes(`${siblingDirPath}/api/server.ts`),
    "the server file is a global pin at its absolute path"
  );
  assert.ok(
    globalPaths.includes(`${siblingDirPath}/README.md`),
    "the README is a global pin at its absolute path"
  );
});

test("a kdcro entry with no type is treated as a File", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  // A type-less entry (older kdcro files) carries a fsPath and counts as a File.
  nodeFs.writeFileSync(
    `${siblingDirPath}/.favorites.json`,
    JSON.stringify([{ fsPath: `${siblingDirPath}/main.ts` }])
  );

  const added = await importSiblingFavorites(sibling("kdcro", ".favorites.json"), store);
  assert.equal(added, 1, "the type-less entry imports as a File");
});

test("a saropa sibling file resolves its relative paths against the sibling folder", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  // Our own format stores folder-relative paths; they join back to the sibling dir
  // to become absolute global pins.
  nodeFs.writeFileSync(
    `${siblingDirPath}/.vscode/saropa-workspace.json`,
    JSON.stringify({ pins: [{ path: "src/app.ts" }, { path: "lib/db.ts" }] })
  );

  const added = await importSiblingFavorites(
    sibling("saropa", ".vscode/saropa-workspace.json"),
    store
  );

  assert.equal(added, 2, "both relative pins resolve and import");
  const globalPaths = store.getGlobalShortcuts().map((p) => p.path.replace(/\\/g, "/"));
  assert.ok(
    globalPaths.includes(`${siblingDirPath}/src/app.ts`),
    "the relative path joins to the sibling folder as an absolute global pin"
  );
});

test("a malformed sibling file imports nothing and does not throw", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  nodeFs.writeFileSync(`${siblingDirPath}/.favorites.json`, "{ not valid json");

  const added = await importSiblingFavorites(sibling("kdcro", ".favorites.json"), store);
  assert.equal(added, 0, "a malformed file imports nothing rather than throwing");
});

test("a missing sibling file imports nothing", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  // No file written: the readFile rejects and resolveSiblingUris returns nothing.
  const added = await importSiblingFavorites(sibling("kdcro", ".favorites.json"), store);
  assert.equal(added, 0, "an absent file contributes nothing");
});

test("re-importing the same sibling file adds no duplicate global pins (idempotent)", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  nodeFs.writeFileSync(
    `${siblingDirPath}/.favorites.json`,
    JSON.stringify([{ type: "File", fsPath: `${siblingDirPath}/main.ts` }])
  );
  const descriptor = sibling("kdcro", ".favorites.json");

  const first = await importSiblingFavorites(descriptor, store);
  assert.equal(first, 1, "the file imports on the first pass");

  // The store dedupes global pins by absolute path, so the second pass adds nothing.
  const second = await importSiblingFavorites(descriptor, store);
  assert.equal(second, 0, "the second pass adds no duplicate");

  assert.equal(
    store
      .getGlobalShortcuts()
      .filter((p) => p.path.replace(/\\/g, "/") === `${siblingDirPath}/main.ts`).length,
    1,
    "the global pin exists exactly once"
  );
});

// Store-IO tests for PinStore (roadmap 4.2 — the items 4.1 deferred as "needs the
// host"). These run the REAL store persistence code: workspace.fs is backed by a
// temp directory on the actual filesystem and the ExtensionContext mementos are
// real Maps, so readProjectFile / writeProjectFile / ensureProjectFile / the
// v1->v2 migration / seedAutoPins all execute for real. Only the host SHELL (the
// vscode API surface) is faked — which is unavoidable outside the Electron host —
// so this tests the store, not a reimplementation of it. No @vscode/test-electron,
// no Electron download: the fs-backed shim covers the same code.
//
// The stub helpers are imported by relative path so tsc resolves them (the bare
// "vscode" types carry no such exports); esbuild aliases "vscode" to that same file
// so the store and this test share one stub-state module.

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
import { PROJECT_FILE_RELATIVE, PROJECT_PINS_VERSION } from "../model/pin";
import type { Uri as VscodeUri } from "vscode";

// The store's signatures type their argument as the real vscode.Uri; the stub Uri
// models only the slice the store reads (scheme / fsPath / toString / joinPath).
// Cast at the call site so tsc accepts it while the faithful stub value runs.
const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

// One temp workspace folder per test, torn down after. Paths use forward slashes
// so the stub Uri.joinPath and node fs agree on every OS.
let tmpDir: string;
let folder: WorkspaceFolder;

const configPath = (): string =>
  nodePath.join(tmpDir, ".vscode", "saropa-workspace.json");

const readConfig = (): {
  version: number;
  pins: Array<Record<string, unknown>>;
  groups: unknown[];
  removedAutoPins: string[];
  autoGroups: Record<string, string>;
} => JSON.parse(nodeFs.readFileSync(configPath(), "utf8"));

beforeEach(() => {
  __resetConfig();
  // Skip the recipe-detection graph so a refresh exercises only store IO; recipes
  // have their own (pure) detector tests and would otherwise read project files.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-store-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("refresh creates a v2 .vscode/saropa-workspace.json for a folder with none", async () => {
  // ensureProjectFile must seed a committed, shareable config file on open — not
  // only after the first pin — so a fresh project has one immediately.
  const store = new PinStore(fakeContext());
  await store.init();
  assert.ok(nodeFs.existsSync(configPath()), "config file should be created");
  assert.equal(readConfig().version, PROJECT_PINS_VERSION);
});

test("a project pin round-trips through the file across store instances", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "src/app.ts");
  assert.equal(await store.addPin(asUri(target), "project"), true);
  assert.ok(store.getProjectPins().some((p) => p.path === "src/app.ts"));

  // A different context (so globalState cannot be the carrier) reading the SAME
  // folder must see the pin — proving it persisted to the project file on disk.
  const reopened = new PinStore(fakeContext());
  await reopened.init();
  assert.ok(
    reopened.getProjectPins().some((p) => p.path === "src/app.ts"),
    "project pin should load from disk in a new store instance"
  );
});

test("addPin dedupes the same project path (second add is a no-op)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "README.md");
  assert.equal(await store.addPin(asUri(target), "project"), true);
  assert.equal(await store.addPin(asUri(target), "project"), false);
  assert.equal(
    store.getProjectPins().filter((p) => p.path === "README.md").length,
    1
  );
});

test("a global pin round-trips through globalState across store instances", async () => {
  const context = fakeContext();
  const store = new PinStore(context);
  await store.init();
  const target = Uri.file(tmpDir + "/notes.md");
  assert.equal(await store.addPin(asUri(target), "global"), true);
  assert.ok(store.getGlobalPins().some((p) => p.path.endsWith("notes.md")));

  // Same context (shared globalState memento) -> a new store reads it back.
  const reopened = new PinStore(context);
  await reopened.init();
  assert.ok(
    reopened.getGlobalPins().some((p) => p.path.endsWith("notes.md")),
    "global pin should load from the shared globalState"
  );
});

test("an auto-pin is seeded from a literal pattern, then removable and restorable", async () => {
  // A literal (non-glob) pattern takes the store's fs.stat seeding branch.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");

  const store = new PinStore(fakeContext());
  await store.init();
  const seeded = store
    .getProjectPins()
    .find((p) => p.isAuto && p.path === "config.yaml");
  assert.ok(seeded, "auto-pin should be seeded from the matching file");

  // Removing an auto-pin records its id in removedAutoPins (it is recomputed, not
  // stored), so it is not re-seeded on the next refresh.
  await store.removePin(seeded!);
  assert.ok(
    !store.getProjectPins().some((p) => p.path === "config.yaml" && p.isAuto),
    "removed auto-pin should not reappear"
  );
  assert.ok(
    readConfig().removedAutoPins.includes(seeded!.id),
    "removal should be recorded in removedAutoPins"
  );

  // Restore clears every folder's suppressions and re-seeds.
  assert.equal(await store.restoreAutoPins(), 1);
  assert.ok(
    store.getProjectPins().some((p) => p.path === "config.yaml" && p.isAuto),
    "restored auto-pin should reappear"
  );
});

test("an auto-pin is seeded from a glob pattern via findFiles", async () => {
  // A glob pattern takes the store's findFiles branch (the stub walks the temp tree).
  __setConfig("saropaWorkspace", "autoPins.patterns", ["**/*.gradle"]);
  nodeFs.mkdirSync(nodePath.join(tmpDir, "android"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(tmpDir, "android", "build.gradle"), "x\n");

  const store = new PinStore(fakeContext());
  await store.init();
  assert.ok(
    store
      .getProjectPins()
      .some((p) => p.isAuto && p.path === "android/build.gradle"),
    "glob auto-pin should be seeded from the nested match"
  );
});

test("a v1 file is migrated to the current version on read and persisted on the next write", async () => {
  // Write a v1 file by hand (no groups / autoGroups, version 1) with one pin.
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".vscode"), { recursive: true });
  nodeFs.writeFileSync(
    configPath(),
    JSON.stringify({
      version: 1,
      pins: [{ id: "p1", path: "lib/main.ts", scope: "project", order: 0 }],
    })
  );

  const store = new PinStore(fakeContext());
  await store.init();
  // Migration on read: the v1 pin renders (no field dropped), groups default to [].
  assert.ok(
    store.getProjectPins().some((p) => p.id === "p1" && p.path === "lib/main.ts"),
    "v1 pin should survive the migration on read"
  );

  // Read is non-destructive: the file stays v1 until something writes it.
  assert.equal(readConfig().version, 1, "read alone must not rewrite the file");

  // Any mutation rewrites at the current version with the new structural fields,
  // keeping the pin.
  await store.createGroup("project", "Build");
  const after = readConfig();
  assert.equal(
    after.version,
    PROJECT_PINS_VERSION,
    "a write should persist the current version"
  );
  assert.ok(Array.isArray(after.groups), "migrated file should carry a groups array");
  assert.ok(
    after.pins.some((p) => p.id === "p1"),
    "the v1 pin must not be dropped by the migration"
  );
});

test("the synthetic Workspace-config example pin targets the folder's own config file", async () => {
  // A brand-new project should always show at least one usable pin (the entry point
  // for editing pins) — the synthesized config example, recomputed, not stored.
  const store = new PinStore(fakeContext());
  await store.init();
  assert.ok(
    store
      .getProjectPins()
      .some((p) => p.isAuto && p.path === PROJECT_FILE_RELATIVE),
    "the config example pin should be present in an otherwise empty project"
  );
});

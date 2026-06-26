// Store-IO tests for ShortcutStore (roadmap 4.2 — the items 4.1 deferred as "needs the
// host"). These run the REAL store persistence code: workspace.fs is backed by a
// temp directory on the actual filesystem and the ExtensionContext mementos are
// real Maps, so readProjectFile / writeProjectFile / ensureProjectFile / the
// v1->v2 migration / seedAutoShortcuts all execute for real. Only the host SHELL (the
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
import { ShortcutStore } from "../model/shortcutStore";
import { PROJECT_FILE_RELATIVE, PROJECT_SHORTCUTS_VERSION } from "../model/shortcut";
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
  // only after the first shortcut — so a fresh project has one immediately.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.ok(nodeFs.existsSync(configPath()), "config file should be created");
  assert.equal(readConfig().version, PROJECT_SHORTCUTS_VERSION);
});

test("a project pin round-trips through the file across store instances", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "src/app.ts");
  assert.equal(await store.addShortcut(asUri(target), "project"), true);
  assert.ok(store.getProjectShortcuts().some((p) => p.path === "src/app.ts"));

  // A different context (so globalState cannot be the carrier) reading the SAME
  // folder must see the shortcut — proving it persisted to the project file on disk.
  const reopened = new ShortcutStore(fakeContext());
  await reopened.init();
  assert.ok(
    reopened.getProjectShortcuts().some((p) => p.path === "src/app.ts"),
    "project pin should load from disk in a new store instance"
  );
});

test("setMasked persists the flag and clearing drops it (round-trip parity)", async () => {
  // WOW #26: masking a shortcut must survive a reload (so the screen-share guard sticks
  // across sessions), and unmasking must remove the field entirely rather than
  // leave masked:false behind — the store collapses an off flag to undefined.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, ".env.production");
  assert.equal(await store.addShortcut(asUri(target), "project"), true);
  const shortcut = store
    .getProjectShortcuts()
    .find((p) => p.path === ".env.production");
  assert.ok(shortcut, "the pin should exist before masking");

  await store.setMasked(shortcut!, true);
  assert.equal(
    readConfig().pins.find((p) => p.path === ".env.production")?.masked,
    true,
    "masked:true should be written to the project file"
  );

  // A fresh store reading the same folder sees the masked flag from disk.
  const reopened = new ShortcutStore(fakeContext());
  await reopened.init();
  const reloaded = reopened
    .getProjectShortcuts()
    .find((p) => p.path === ".env.production");
  assert.equal(reloaded?.masked, true, "masked flag should load from disk");

  // Unmasking removes the field (no stale masked:false on a revealed shortcut).
  await reopened.setMasked(reloaded!, false);
  assert.equal(
    "masked" in (readConfig().pins.find((p) => p.path === ".env.production") ?? {}),
    false,
    "unmasking should drop the masked field, not store false"
  );
});

test("addPin dedupes the same project path (second add is a no-op)", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "README.md");
  assert.equal(await store.addShortcut(asUri(target), "project"), true);
  assert.equal(await store.addShortcut(asUri(target), "project"), false);
  assert.equal(
    store.getProjectShortcuts().filter((p) => p.path === "README.md").length,
    1
  );
});

test("a global pin round-trips through globalState across store instances", async () => {
  const context = fakeContext();
  const store = new ShortcutStore(context);
  await store.init();
  const target = Uri.file(tmpDir + "/notes.md");
  assert.equal(await store.addShortcut(asUri(target), "global"), true);
  assert.ok(store.getGlobalShortcuts().some((p) => p.path.endsWith("notes.md")));

  // Same context (shared globalState memento) -> a new store reads it back.
  const reopened = new ShortcutStore(context);
  await reopened.init();
  assert.ok(
    reopened.getGlobalShortcuts().some((p) => p.path.endsWith("notes.md")),
    "global pin should load from the shared globalState"
  );
});

test("an auto-pin is seeded from a literal pattern, then removable and restorable", async () => {
  // A literal (non-glob) pattern takes the store's fs.stat seeding branch.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");

  const store = new ShortcutStore(fakeContext());
  await store.init();
  const seeded = store
    .getProjectShortcuts()
    .find((p) => p.isAuto && p.path === "config.yaml");
  assert.ok(seeded, "auto-pin should be seeded from the matching file");

  // Removing an auto-shortcut records its id in removedAutoPins (it is recomputed, not
  // stored), so it is not re-seeded on the next refresh.
  await store.removeShortcut(seeded!);
  assert.ok(
    !store.getProjectShortcuts().some((p) => p.path === "config.yaml" && p.isAuto),
    "removed auto-pin should not reappear"
  );
  assert.ok(
    readConfig().removedAutoPins.includes(seeded!.id),
    "removal should be recorded in removedAutoPins"
  );

  // Restore clears every folder's suppressions and re-seeds.
  assert.equal(await store.restoreAutoShortcuts(), 1);
  assert.ok(
    store.getProjectShortcuts().some((p) => p.path === "config.yaml" && p.isAuto),
    "restored auto-pin should reappear"
  );
});

test("an auto-pin is seeded from a glob pattern via findFiles", async () => {
  // A glob pattern takes the store's findFiles branch (the stub walks the temp tree).
  __setConfig("saropaWorkspace", "autoPins.patterns", ["**/*.gradle"]);
  nodeFs.mkdirSync(nodePath.join(tmpDir, "android"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(tmpDir, "android", "build.gradle"), "x\n");

  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.ok(
    store
      .getProjectShortcuts()
      .some((p) => p.isAuto && p.path === "android/build.gradle"),
    "glob auto-pin should be seeded from the nested match"
  );
});

test("a v1 file is migrated to the current version on read and persisted on the next write", async () => {
  // Write a v1 file by hand (no groups / autoGroups, version 1) with one shortcut.
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".vscode"), { recursive: true });
  nodeFs.writeFileSync(
    configPath(),
    JSON.stringify({
      version: 1,
      pins: [{ id: "p1", path: "lib/main.ts", scope: "project", order: 0 }],
    })
  );

  const store = new ShortcutStore(fakeContext());
  await store.init();
  // Migration on read: the v1 shortcut renders (no field dropped), groups default to [].
  assert.ok(
    store.getProjectShortcuts().some((p) => p.id === "p1" && p.path === "lib/main.ts"),
    "v1 pin should survive the migration on read"
  );

  // Read is non-destructive: the file stays v1 until something writes it.
  assert.equal(readConfig().version, 1, "read alone must not rewrite the file");

  // Any mutation rewrites at the current version with the new structural fields,
  // keeping the shortcut.
  await store.createGroup("project", "Build");
  const after = readConfig();
  assert.equal(
    after.version,
    PROJECT_SHORTCUTS_VERSION,
    "a write should persist the current version"
  );
  assert.ok(Array.isArray(after.groups), "migrated file should carry a groups array");
  assert.ok(
    after.pins.some((p) => p.id === "p1"),
    "the v1 pin must not be dropped by the migration"
  );
});

// Raw file read that also exposes the shortcut-set fields (the typed readConfig above
// predates sets). Used by the shortcut-set tests below to assert on-disk structure.
const readRaw = (): {
  version: number;
  pins: Array<Record<string, unknown>>;
  groups: unknown[];
  activeSet?: string;
  sets?: Array<{ name: string; pins: Array<Record<string, unknown>> }>;
} => JSON.parse(nodeFs.readFileSync(configPath(), "utf8"));

test("a v2 file migrates to the Default set with no pin moved or dropped", async () => {
  // Write a v2 file by hand (groups present, but no activeSet/sets) with one shortcut.
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".vscode"), { recursive: true });
  nodeFs.writeFileSync(
    configPath(),
    JSON.stringify({
      version: 2,
      pins: [{ id: "p1", path: "lib/main.ts", scope: "project", order: 0 }],
      groups: [],
    })
  );

  const store = new ShortcutStore(fakeContext());
  await store.init();
  // The v2 shortcut renders unchanged and the workspace reads as the single Default set.
  assert.ok(
    store.getProjectShortcuts().some((p) => p.id === "p1" && p.path === "lib/main.ts"),
    "v2 pin should survive the v2->v3 migration on read"
  );
  assert.equal(store.getActiveSetName(), "Default");
  assert.deepEqual(store.getSetNames(), ["Default"]);

  // Read is non-destructive: the file stays v2 until something writes it.
  assert.equal(readRaw().version, 2, "read alone must not rewrite the file");

  // A mutation persists the current version with the set metadata; the shortcut stays
  // at the top level (it IS the Default set's content), and sets is empty.
  await store.createGroup("project", "Build");
  const after = readRaw();
  assert.equal(after.version, PROJECT_SHORTCUTS_VERSION);
  assert.equal(after.activeSet, "Default");
  assert.deepEqual(after.sets, []);
  assert.ok(
    after.pins.some((p) => p.id === "p1"),
    "the v2 pin must not be dropped by the migration"
  );
});

test("creating a set switches to it (empty project pins) and the old set is restorable", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "src/app.ts");
  await store.addShortcut(asUri(target), "project");

  // Create + switch to a second set: the stored project pins start empty there.
  assert.equal(await store.createSet("Feature"), "created");
  assert.equal(store.getActiveSetName(), "Feature");
  assert.deepEqual(store.getSetNames(), ["Default", "Feature"]);
  assert.ok(
    !store.getProjectShortcuts().some((p) => !p.isAuto && p.path === "src/app.ts"),
    "the new set should not carry the Default set's pins"
  );
  // The Default set's shortcut is stashed on disk, not lost.
  assert.ok(
    readRaw().sets?.some(
      (s) => s.name === "Default" && s.pins.some((p) => p.path === "src/app.ts")
    ),
    "the outgoing set's pins should be stashed under its name"
  );

  // Switching back restores the original shortcut.
  await store.switchSet("Default");
  assert.equal(store.getActiveSetName(), "Default");
  assert.ok(
    store.getProjectShortcuts().some((p) => p.path === "src/app.ts"),
    "switching back should restore the Default set's pins"
  );
});

test("createSet rejects a duplicate name (case-insensitive)", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(await store.createSet("Release"), "created");
  assert.equal(await store.createSet("release"), "exists");
  assert.equal(store.getSetNames().length, 2); // Default + Release, no third
});

test("renameSet renames the active set across the file", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(await store.renameSet("Default", "Main"), "renamed");
  assert.equal(store.getActiveSetName(), "Main");
  assert.equal(readRaw().activeSet, "Main");
  // A clash with an existing name is rejected.
  await store.createSet("Side");
  assert.equal(await store.renameSet("Side", "Main"), "exists");
});

test("deleteSet drops a set's pins and refuses to delete the last one", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  // The lone Default set cannot be deleted.
  assert.equal((await store.deleteSet("Default")).outcome, "lastOne");

  // Add a shortcut to Default, make a second set, then delete the active second set:
  // the workspace falls back to Default and its shortcut is intact.
  const target = Uri.joinPath(folder.uri, "keep.ts");
  await store.addShortcut(asUri(target), "project");
  await store.createSet("Temp");
  assert.equal(store.getActiveSetName(), "Temp");
  const result = await store.deleteSet("Temp");
  assert.equal(result.outcome, "deleted");
  assert.equal(result.active, "Default");
  assert.deepEqual(store.getSetNames(), ["Default"]);
  assert.ok(
    store.getProjectShortcuts().some((p) => p.path === "keep.ts"),
    "deleting another set must not touch the Default set's pins"
  );
});

test("duplicateSet copies pins with fresh ids and switches to the copy", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "dup.ts");
  await store.addShortcut(asUri(target), "project");
  const sourceId = store.getProjectShortcuts().find((p) => p.path === "dup.ts")?.id;

  assert.equal(await store.duplicateSet("Default", "Copy"), "duplicated");
  assert.equal(store.getActiveSetName(), "Copy");
  const copied = store.getProjectShortcuts().find((p) => p.path === "dup.ts");
  assert.ok(copied, "the duplicate set should carry a copy of the pin");
  assert.notEqual(
    copied!.id,
    sourceId,
    "the copied pin should get a fresh id, not share the source's"
  );
});

test("the synthetic Workspace-config example pin targets the folder's own config file", async () => {
  // A brand-new project should always show at least one usable shortcut (the entry point
  // for editing pins) — the synthesized config example, recomputed, not stored.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.ok(
    store
      .getProjectShortcuts()
      .some((p) => p.isAuto && p.path === PROJECT_FILE_RELATIVE),
    "the config example pin should be present in an otherwise empty project"
  );
});

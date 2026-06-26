// Unit tests for the core mutation layer (model/shortcutStoreMutationCore.ts): add /
// addLine / addShell / addAnnotation / import pins, remove / rename / re-point, the
// shared placeAfter (ordered insert) and mutateShortcut (find-apply-persist) helpers.
// These are the abstract internals ShortcutStore composes, so the tests drive a real
// ShortcutStore against the fs-backed vscode stub over a temp directory and assert the
// behavior distinct to THIS layer — the variant add paths and the ordered insert —
// rather than re-covering the store round-trips already in shortcutStore.test.ts.

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
import { shortcutKind } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-mutcore-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("addPin into a named group creates the group once and assigns membership", async () => {
  // The shortcut's groupId must resolve to a group created in the SAME folder's file, and
  // a second add into the same group name reuses it (label-matched, idempotent).
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", undefined, "Build");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "b.ts")), "project", undefined, "Build");
  const groups = store.getProjectGroups().filter((g) => g.label === "Build");
  assert.equal(groups.length, 1, "the named group is created once, not per pin");
  const groupId = groups[0].id;
  const inGroup = store.getProjectShortcuts().filter((p) => p.groupId === groupId);
  assert.equal(inGroup.length, 2, "both pins join the single named group");
});

test("addPin returns false for a project file outside any workspace folder", async () => {
  // A file the workspace does not own cannot be a project shortcut (no folder to store it
  // relative to); the caller offers global instead.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const outside = Uri.file("/elsewhere/not-in-workspace.ts");
  assert.equal(await store.addShortcut(asUri(outside), "project"), false);
});

test("addLinePin does NOT dedupe by path — the same file pins to several lines", async () => {
  // Unlike addShortcut, a line shortcut is a distinct jump target, so the same file may be
  // added to multiple lines; each add creates a new shortcut.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "big.ts");
  assert.equal(await store.addLineShortcut(asUri(target), "project", 10, "fn A"), true);
  assert.equal(await store.addLineShortcut(asUri(target), "project", 200, "fn B"), true);
  const lineShortcuts = store.getProjectShortcuts().filter((p) => p.path === "big.ts" && p.line);
  assert.equal(lineShortcuts.length, 2);
  assert.deepEqual(lineShortcuts.map((p) => p.line).sort((x, y) => x! - y!), [10, 200]);
});

test("addShellPin stores a runnable shell action with no file path", async () => {
  // A shell shortcut carries the command in action.shell and an empty path; shortcutKind must
  // route it as "shell", and it is added (not run).
  const store = new ShortcutStore(fakeContext());
  await store.init();
  assert.equal(await store.addShellShortcut("Tests", "npm test", "project", true), true);
  const shortcut = store.getProjectShortcuts().find((p) => p.label === "Tests");
  assert.ok(shortcut);
  assert.equal(shortcut!.path, "");
  assert.equal(shortcutKind(shortcut!), "shell");
  assert.equal(shortcut!.action?.shellCommand, "npm test");
});

test("addAnnotationPin inserts a comment immediately after its anchor pin", async () => {
  // A comment anchored to a shortcut must land directly below it (placeAfter), so the
  // annotation sits exactly where the user clicked — its order is the anchor's + 1.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "first.ts")), "project");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "second.ts")), "project");
  const anchor = store.getProjectShortcuts().find((p) => p.path === "first.ts")!;
  assert.equal(await store.addAnnotationShortcut("comment", "project", "A note", anchor), true);

  // Within the top-level group, the comment's order is one past the anchor's.
  const note = store.getProjectShortcuts().find((p) => p.label === "A note")!;
  assert.equal(shortcutKind(note), "comment");
  assert.equal(note.order, anchor.order + 1, "the comment lands directly after its anchor");
});

test("removePin drops an explicit pin but suppresses an auto-pin via removedAutoPins", async () => {
  // Two distinct removal paths in this layer: an explicit shortcut is filtered out of
  // pins[]; an auto-shortcut (not stored there) is suppressed so it is not re-seeded.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new ShortcutStore(fakeContext());
  await store.init();

  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "explicit.ts")), "project");
  const explicit = store.getProjectShortcuts().find((p) => p.path === "explicit.ts")!;
  await store.removeShortcut(explicit);
  assert.ok(
    !store.getProjectShortcuts().some((p) => p.path === "explicit.ts"),
    "an explicit pin is removed from pins[]"
  );

  const auto = store.getProjectShortcuts().find((p) => p.isAuto && p.path === "config.yaml")!;
  await store.removeShortcut(auto);
  const onDisk = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".vscode", "saropa-workspace.json"), "utf8")
  );
  assert.ok(
    onDisk.removedAutoPins.includes(auto.id),
    "an auto-pin removal is recorded in removedAutoPins, not by deleting a stored pin"
  );
});

test("updatePinPath rejects re-pointing a project pin outside its owning folder", async () => {
  // A project shortcut stores a folder-relative path and cannot reach a sibling folder;
  // a target outside the owner is refused with false so the caller can tell the user.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  const outside = Uri.file("/elsewhere/b.ts");
  assert.equal(await store.updateShortcutPath(shortcut, asUri(outside)), false);
  // A target inside the owning folder is accepted and the stored path updates.
  const inside = Uri.joinPath(folder.uri, "moved/a.ts");
  assert.equal(await store.updateShortcutPath(shortcut, asUri(inside)), true);
  assert.ok(store.getProjectShortcuts().some((p) => p.path === "moved/a.ts"));
});

test("renamePin clears the label override when given a blank name", async () => {
  // A blank rename drops the override so the shortcut falls back to the file basename,
  // rather than storing an empty string.
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", "Alias");
  let shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  assert.equal(shortcut.label, "Alias");
  await store.renameShortcut(shortcut, "   ");
  shortcut = store.getProjectShortcuts().find((p) => p.path === "a.ts")!;
  assert.equal(shortcut.label, undefined, "a blank rename clears the alias to the basename default");
});

test("mutatePin is a no-op on an auto-pin (recomputed, not stored)", async () => {
  // Auto-pins have no stored target, so a field toggle routed through mutateShortcut must
  // not throw and must not persist anything — the masked toggle is one such caller.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new ShortcutStore(fakeContext());
  await store.init();
  const auto = store.getProjectShortcuts().find((p) => p.isAuto && p.path === "config.yaml")!;
  // setMasked routes through mutateShortcut; on an auto-shortcut it finds no target and no-ops.
  await store.setMasked(auto, true);
  const onDisk = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".vscode", "saropa-workspace.json"), "utf8")
  );
  assert.equal(
    onDisk.pins.some((p: { masked?: boolean }) => p.masked),
    false,
    "masking an auto-pin writes nothing to the stored pins"
  );
});

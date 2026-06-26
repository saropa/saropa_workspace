// Unit tests for the core mutation layer (model/pinStoreMutationCore.ts): add /
// addLine / addShell / addAnnotation / import pins, remove / rename / re-point, the
// shared placeAfter (ordered insert) and mutatePin (find-apply-persist) helpers.
// These are the abstract internals PinStore composes, so the tests drive a real
// PinStore against the fs-backed vscode stub over a temp directory and assert the
// behavior distinct to THIS layer — the variant add paths and the ordered insert —
// rather than re-covering the store round-trips already in pinStore.test.ts.

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
import { pinKind } from "../model/pin";
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
  // The pin's groupId must resolve to a group created in the SAME folder's file, and
  // a second add into the same group name reuses it (label-matched, idempotent).
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", undefined, "Build");
  await store.addPin(asUri(Uri.joinPath(folder.uri, "b.ts")), "project", undefined, "Build");
  const groups = store.getProjectGroups().filter((g) => g.label === "Build");
  assert.equal(groups.length, 1, "the named group is created once, not per pin");
  const groupId = groups[0].id;
  const inGroup = store.getProjectPins().filter((p) => p.groupId === groupId);
  assert.equal(inGroup.length, 2, "both pins join the single named group");
});

test("addPin returns false for a project file outside any workspace folder", async () => {
  // A file the workspace does not own cannot be a project pin (no folder to store it
  // relative to); the caller offers global instead.
  const store = new PinStore(fakeContext());
  await store.init();
  const outside = Uri.file("/elsewhere/not-in-workspace.ts");
  assert.equal(await store.addPin(asUri(outside), "project"), false);
});

test("addLinePin does NOT dedupe by path — the same file pins to several lines", async () => {
  // Unlike addPin, a line pin is a distinct jump target, so the same file may be
  // pinned to multiple lines; each add creates a new pin.
  const store = new PinStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "big.ts");
  assert.equal(await store.addLinePin(asUri(target), "project", 10, "fn A"), true);
  assert.equal(await store.addLinePin(asUri(target), "project", 200, "fn B"), true);
  const linePins = store.getProjectPins().filter((p) => p.path === "big.ts" && p.line);
  assert.equal(linePins.length, 2);
  assert.deepEqual(linePins.map((p) => p.line).sort((x, y) => x! - y!), [10, 200]);
});

test("addShellPin stores a runnable shell action with no file path", async () => {
  // A shell pin carries the command in action.shell and an empty path; pinKind must
  // route it as "shell", and it is added (not run).
  const store = new PinStore(fakeContext());
  await store.init();
  assert.equal(await store.addShellPin("Tests", "npm test", "project", true), true);
  const pin = store.getProjectPins().find((p) => p.label === "Tests");
  assert.ok(pin);
  assert.equal(pin!.path, "");
  assert.equal(pinKind(pin!), "shell");
  assert.equal(pin!.action?.shellCommand, "npm test");
});

test("addAnnotationPin inserts a comment immediately after its anchor pin", async () => {
  // A comment anchored to a pin must land directly below it (placeAfter), so the
  // annotation sits exactly where the user clicked — its order is the anchor's + 1.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "first.ts")), "project");
  await store.addPin(asUri(Uri.joinPath(folder.uri, "second.ts")), "project");
  const anchor = store.getProjectPins().find((p) => p.path === "first.ts")!;
  assert.equal(await store.addAnnotationPin("comment", "project", "A note", anchor), true);

  // Within the top-level group, the comment's order is one past the anchor's.
  const note = store.getProjectPins().find((p) => p.label === "A note")!;
  assert.equal(pinKind(note), "comment");
  assert.equal(note.order, anchor.order + 1, "the comment lands directly after its anchor");
});

test("removePin drops an explicit pin but suppresses an auto-pin via removedAutoPins", async () => {
  // Two distinct removal paths in this layer: an explicit pin is filtered out of
  // pins[]; an auto-pin (not stored there) is suppressed so it is not re-seeded.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new PinStore(fakeContext());
  await store.init();

  await store.addPin(asUri(Uri.joinPath(folder.uri, "explicit.ts")), "project");
  const explicit = store.getProjectPins().find((p) => p.path === "explicit.ts")!;
  await store.removePin(explicit);
  assert.ok(
    !store.getProjectPins().some((p) => p.path === "explicit.ts"),
    "an explicit pin is removed from pins[]"
  );

  const auto = store.getProjectPins().find((p) => p.isAuto && p.path === "config.yaml")!;
  await store.removePin(auto);
  const onDisk = JSON.parse(
    nodeFs.readFileSync(nodePath.join(tmpDir, ".vscode", "saropa-workspace.json"), "utf8")
  );
  assert.ok(
    onDisk.removedAutoPins.includes(auto.id),
    "an auto-pin removal is recorded in removedAutoPins, not by deleting a stored pin"
  );
});

test("updatePinPath rejects re-pointing a project pin outside its owning folder", async () => {
  // A project pin stores a folder-relative path and cannot reach a sibling folder;
  // a target outside the owner is refused with false so the caller can tell the user.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  const pin = store.getProjectPins().find((p) => p.path === "a.ts")!;
  const outside = Uri.file("/elsewhere/b.ts");
  assert.equal(await store.updatePinPath(pin, asUri(outside)), false);
  // A target inside the owning folder is accepted and the stored path updates.
  const inside = Uri.joinPath(folder.uri, "moved/a.ts");
  assert.equal(await store.updatePinPath(pin, asUri(inside)), true);
  assert.ok(store.getProjectPins().some((p) => p.path === "moved/a.ts"));
});

test("renamePin clears the label override when given a blank name", async () => {
  // A blank rename drops the override so the pin falls back to the file basename,
  // rather than storing an empty string.
  const store = new PinStore(fakeContext());
  await store.init();
  await store.addPin(asUri(Uri.joinPath(folder.uri, "a.ts")), "project", "Alias");
  let pin = store.getProjectPins().find((p) => p.path === "a.ts")!;
  assert.equal(pin.label, "Alias");
  await store.renamePin(pin, "   ");
  pin = store.getProjectPins().find((p) => p.path === "a.ts")!;
  assert.equal(pin.label, undefined, "a blank rename clears the alias to the basename default");
});

test("mutatePin is a no-op on an auto-pin (recomputed, not stored)", async () => {
  // Auto-pins have no stored target, so a field toggle routed through mutatePin must
  // not throw and must not persist anything — the masked toggle is one such caller.
  __setConfig("saropaWorkspace", "autoPins.patterns", ["config.yaml"]);
  nodeFs.writeFileSync(nodePath.join(tmpDir, "config.yaml"), "a: 1\n");
  const store = new PinStore(fakeContext());
  await store.init();
  const auto = store.getProjectPins().find((p) => p.isAuto && p.path === "config.yaml")!;
  // setMasked routes through mutatePin; on an auto-pin it finds no target and no-ops.
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

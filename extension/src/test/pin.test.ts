// Unit tests for the core pin data model (model/pin.ts). This module is pure
// types plus a handful of exported helpers and constants — pinKind /
// isAnnotationPin / emptyProjectPinsFile and the PROJECT_PINS_VERSION /
// DEFAULT_SET_NAME / PROJECT_FILE_RELATIVE literals. It imports only TYPES from
// vscode (esbuild strips those), so it bundles and runs under Node's built-in
// runner with no host. These assert the discriminated-union routing (which pins
// are annotations, what kind a pin runs as) and the empty-file shape the store
// seeds, since every consumer of the model depends on those being exact.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Pin,
  pinKind,
  isAnnotationPin,
  emptyProjectPinsFile,
  PROJECT_PINS_VERSION,
  DEFAULT_SET_NAME,
  PROJECT_FILE_RELATIVE,
} from "../model/pin";

// A minimal stored pin; callers override only the fields a case exercises. The
// model requires id / path / scope / order, so the base supplies those.
function pin(over: Partial<Pin>): Pin {
  return { id: "x", path: "a.ts", scope: "project", order: 0, ...over } as Pin;
}

test("pinKind: a pin with no action runs as a file (the implicit Phase-1 default)", () => {
  // The whole "file" branch hinges on action being absent — every plain file pin
  // takes this path, so the fallback must be exactly "file".
  assert.equal(pinKind(pin({})), "file");
});

test("pinKind: a pin's action kind is its run kind", () => {
  // Each non-file action reports its own kind so the runner/dispatcher route it.
  assert.equal(pinKind(pin({ action: { kind: "shell" } })), "shell");
  assert.equal(pinKind(pin({ action: { kind: "url" } })), "url");
  assert.equal(pinKind(pin({ action: { kind: "command" } })), "command");
  assert.equal(pinKind(pin({ action: { kind: "macro" } })), "macro");
  assert.equal(pinKind(pin({ action: { kind: "routine" } })), "routine");
});

test("isAnnotationPin: only comment and separator are inert annotations", () => {
  // The single guard point for the non-runnable kinds: the runner, the click
  // dispatcher, and badges all consult this, so it must include exactly these two.
  assert.equal(isAnnotationPin(pin({ action: { kind: "comment" } })), true);
  assert.equal(isAnnotationPin(pin({ action: { kind: "separator" } })), true);
});

test("isAnnotationPin: every runnable / openable kind is NOT an annotation", () => {
  // A file pin (no action) and each real action must fail the predicate so they
  // keep their run/open behavior — a false positive here would silence a real pin.
  assert.equal(isAnnotationPin(pin({})), false);
  assert.equal(isAnnotationPin(pin({ action: { kind: "shell" } })), false);
  assert.equal(isAnnotationPin(pin({ action: { kind: "url" } })), false);
  assert.equal(isAnnotationPin(pin({ action: { kind: "command" } })), false);
  assert.equal(isAnnotationPin(pin({ action: { kind: "macro" } })), false);
  assert.equal(isAnnotationPin(pin({ action: { kind: "routine" } })), false);
});

test("emptyProjectPinsFile: stamps the current version and the Default set", () => {
  // A brand-new / migrated file must start on the current schema version and the
  // Default set, with every collection empty — this IS the byte-for-byte single-set
  // starting layout the migration and the store's seed both rely on.
  const file = emptyProjectPinsFile();
  assert.equal(file.version, PROJECT_PINS_VERSION);
  assert.equal(file.activeSet, DEFAULT_SET_NAME);
  assert.deepEqual(file.pins, []);
  assert.deepEqual(file.groups, []);
  assert.deepEqual(file.sets, []);
  assert.deepEqual(file.removedAutoPins, []);
  assert.deepEqual(file.removedRecipes, []);
  assert.deepEqual(file.autoGroups, {});
});

test("emptyProjectPinsFile: returns a fresh object each call (no shared mutable state)", () => {
  // Two readers seeding their own folders must not share arrays — a push into one
  // file's pins would otherwise leak into the next folder's seeded file.
  const a = emptyProjectPinsFile();
  const b = emptyProjectPinsFile();
  assert.notEqual(a, b, "each call yields a distinct file object");
  assert.notEqual(a.pins, b.pins, "collections must not be shared between files");
  a.pins.push(pin({}));
  assert.equal(b.pins.length, 0, "mutating one file must not affect another");
});

test("the schema version is 3 (the named-pin-sets version)", () => {
  // The migration logic keys off this exact value; a silent bump would break the
  // v2->v3 default-set migration assertions in the store tests.
  assert.equal(PROJECT_PINS_VERSION, 3);
});

test("the config file relative path is the single source for the seed target", () => {
  // The synthetic "Workspace config" example pin opens this very file, and the
  // store's PROJECT_FILE_RELATIVE must equal it so the seed and the IO path agree.
  assert.equal(PROJECT_FILE_RELATIVE, ".vscode/saropa-workspace.json");
});

test("the default set name is the literal 'Default'", () => {
  // The migration, the switcher, and the delete-fallback all compare against this
  // literal; pinning it down here guards against an accidental rename drifting them.
  assert.equal(DEFAULT_SET_NAME, "Default");
});

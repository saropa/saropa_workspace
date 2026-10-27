// Unit tests for routine membership repair (unlinking removed shortcuts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneRoutineMembers, pruneSuppressedRoutineMembers } from "../model/routineMembers";
import type { Shortcut } from "../model/shortcut";
import type { RoutineMember } from "../model/shortcutAction";

function routine(id: string, members: RoutineMember[] | undefined): Shortcut {
  return { id, path: "", scope: "project", action: { kind: "routine", members } } as Shortcut;
}

test("pruneRoutineMembers drops a member by recipeId", () => {
  const r = routine("r", [{ recipeId: "lint" }, { recipeId: "test" }]);
  const dropped = pruneRoutineMembers([r], { id: "x", recipeId: "lint" });
  assert.equal(dropped, 1);
  assert.deepEqual(r.action!.members, [{ recipeId: "test" }]);
});

test("pruneRoutineMembers drops a hand-composed member by pinId", () => {
  const r = routine("r", [{ pinId: "p1" }, { pinId: "p2" }]);
  assert.equal(pruneRoutineMembers([r], { id: "p1" }), 1);
  assert.deepEqual(r.action!.members, [{ pinId: "p2" }]);
});

test("a pinId match is ignored when the member carries a recipeId", () => {
  const r = routine("r", [{ recipeId: "lint", pinId: "p1" }]);
  assert.equal(pruneRoutineMembers([r], { id: "p1" }), 0);
  assert.equal(r.action!.members!.length, 1);
});

test("an empty removed id never matches a pin-only member", () => {
  const r = routine("r", [{ pinId: "" }, {}]);
  assert.equal(pruneRoutineMembers([r], { id: "" }), 0);
  assert.equal(r.action!.members!.length, 2);
});

test("non-routine shortcuts and routines without members are skipped", () => {
  const plain = { id: "s", path: "a", scope: "project" } as Shortcut;
  const shell = { id: "sh", path: "", scope: "project", action: { kind: "shell" } } as Shortcut;
  const empty = routine("e", undefined);
  assert.equal(pruneRoutineMembers([plain, shell, empty], { id: "z", recipeId: "lint" }), 0);
});

test("counts drops across several routines", () => {
  const a = routine("a", [{ recipeId: "lint" }]);
  const b = routine("b", [{ recipeId: "lint" }, { recipeId: "x" }]);
  assert.equal(pruneRoutineMembers([a, b], { id: "q", recipeId: "lint" }), 2);
  assert.deepEqual(a.action!.members, []);
});

test("pruneSuppressedRoutineMembers drops members naming suppressed recipes", () => {
  const r = routine("r", [{ recipeId: "a" }, { recipeId: "b" }, { recipeId: "c" }]);
  assert.equal(pruneSuppressedRoutineMembers([r], ["a", "c"]), 2);
  assert.deepEqual(r.action!.members, [{ recipeId: "b" }]);
});

test("pruneSuppressedRoutineMembers is a no-op with nothing suppressed", () => {
  const r = routine("r", [{ recipeId: "a" }]);
  assert.equal(pruneSuppressedRoutineMembers([r], []), 0);
  assert.equal(r.action!.members!.length, 1);
});

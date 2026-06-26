// Unit tests for the comment / separator annotation entries. These are pure model
// checks (no VS Code, no filesystem): the discriminated-union guard that keeps the
// new non-runnable kinds inert lives in shortcut.ts, so it is tested here in isolation.
// The store positioning (addAnnotationShortcut / placeAfter) and the tree rendering need
// the extension host and are exercised manually — see the finish handoff.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Shortcut, ShortcutKind, shortcutKind, isAnnotationShortcut } from "../model/shortcut";

// A minimal shortcut of a given kind. A file shortcut has no action; every other kind carries
// its kind on `action`, matching how the store writes real pins.
function makeShortcut(kind: ShortcutKind): Shortcut {
  const base: Shortcut = { id: "x", path: "", scope: "project", order: 0 };
  return kind === "file" ? base : { ...base, action: { kind } };
}

test("pinKind: a pin with no action reads as a file pin", () => {
  assert.equal(shortcutKind(makeShortcut("file")), "file");
});

test("pinKind: the action kind is reported verbatim for every action kind", () => {
  const kinds: ShortcutKind[] = ["shell", "url", "command", "macro", "comment", "separator"];
  for (const kind of kinds) {
    assert.equal(shortcutKind(makeShortcut(kind)), kind);
  }
});

test("isAnnotationPin: true only for comment and separator", () => {
  assert.equal(isAnnotationShortcut(makeShortcut("comment")), true);
  assert.equal(isAnnotationShortcut(makeShortcut("separator")), true);
});

test("isAnnotationPin: false for every runnable / openable kind", () => {
  // The guard must NOT capture a real shortcut — a false positive here would make a
  // runnable shortcut silently inert.
  const kinds: ShortcutKind[] = ["file", "shell", "url", "command", "macro"];
  for (const kind of kinds) {
    assert.equal(isAnnotationShortcut(makeShortcut(kind)), false, `${kind} must not be an annotation`);
  }
});

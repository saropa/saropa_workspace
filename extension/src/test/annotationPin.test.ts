// Unit tests for the comment / separator annotation entries. These are pure model
// checks (no VS Code, no filesystem): the discriminated-union guard that keeps the
// new non-runnable kinds inert lives in pin.ts, so it is tested here in isolation.
// The store positioning (addAnnotationPin / placeAfter) and the tree rendering need
// the extension host and are exercised manually — see the finish handoff.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Pin, PinKind, pinKind, isAnnotationPin } from "../model/pin";

// A minimal pin of a given kind. A file pin has no action; every other kind carries
// its kind on `action`, matching how the store writes real pins.
function makePin(kind: PinKind): Pin {
  const base: Pin = { id: "x", path: "", scope: "project", order: 0 };
  return kind === "file" ? base : { ...base, action: { kind } };
}

test("pinKind: a pin with no action reads as a file pin", () => {
  assert.equal(pinKind(makePin("file")), "file");
});

test("pinKind: the action kind is reported verbatim for every action kind", () => {
  const kinds: PinKind[] = ["shell", "url", "command", "macro", "comment", "separator"];
  for (const kind of kinds) {
    assert.equal(pinKind(makePin(kind)), kind);
  }
});

test("isAnnotationPin: true only for comment and separator", () => {
  assert.equal(isAnnotationPin(makePin("comment")), true);
  assert.equal(isAnnotationPin(makePin("separator")), true);
});

test("isAnnotationPin: false for every runnable / openable kind", () => {
  // The guard must NOT capture a real pin — a false positive here would make a
  // runnable pin silently inert.
  const kinds: PinKind[] = ["file", "shell", "url", "command", "macro"];
  for (const kind of kinds) {
    assert.equal(isAnnotationPin(makePin(kind)), false, `${kind} must not be an annotation`);
  }
});

// Unit tests for the shared Pins-view filter predicate, focused on the WOW #17
// tag ("mode") facet. These exercise the pure functions (pinMatchesFilter /
// isFilterActive) with no VS Code dependency, so they run under Node's built-in
// test runner with the vscode stub — see esbuild.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pinMatchesFilter, isFilterActive, PinFilter } from "../views/pinFilter";
import { Pin } from "../model/pin";

// A minimal stored pin; callers override only the fields a case cares about.
function pin(over: Partial<Pin>): Pin {
  return { id: "x", path: "a.ts", scope: "project", order: 0, ...over } as Pin;
}

test("tag facet: a pin carrying the active tag matches", () => {
  assert.equal(
    pinMatchesFilter(pin({ tags: ["ops", "dev"] }), { tag: "ops" }, false),
    true
  );
});

test("tag facet: a pin without the active tag is hidden", () => {
  assert.equal(
    pinMatchesFilter(pin({ tags: ["dev"] }), { tag: "ops" }, false),
    false
  );
});

test("tag facet: an untagged pin is hidden by any tag mode", () => {
  // "Show only #ops" must collapse everything that is not #ops, including pins
  // that carry no tags at all — the whole point of a focus mode.
  assert.equal(pinMatchesFilter(pin({}), { tag: "ops" }, false), false);
});

test("tag facet: no tag set shows every pin", () => {
  assert.equal(pinMatchesFilter(pin({}), {}, false), true);
  assert.equal(pinMatchesFilter(pin({ tags: ["ops"] }), {}, false), true);
});

test("isFilterActive: a tag-only filter is active; an empty filter is not", () => {
  assert.equal(isFilterActive({ tag: "ops" }), true);
  assert.equal(isFilterActive({}), false);
});

test("tag facet composes with the kind facet (both must pass)", () => {
  // Files-only + #ops: a tagged file pin passes both; a tagged shell pin fails the
  // kind facet even though it carries the tag.
  const filter: PinFilter = { kinds: ["file"], tag: "ops" };
  assert.equal(pinMatchesFilter(pin({ tags: ["ops"] }), filter, false), true);
  assert.equal(
    pinMatchesFilter(
      pin({ tags: ["ops"], action: { kind: "shell" } }),
      filter,
      false
    ),
    false
  );
});

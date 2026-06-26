// Unit tests for the shared Shortcuts-view filter predicate, focused on the WOW #17
// tag ("mode") facet. These exercise the pure functions (shortcutMatchesFilter /
// isFilterActive) with no VS Code dependency, so they run under Node's built-in
// test runner with the vscode stub — see esbuild.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutMatchesFilter, isFilterActive, ShortcutFilter } from "../views/shortcutFilter";
import { Shortcut } from "../model/shortcut";

// A minimal stored shortcut; callers override only the fields a case cares about.
function shortcut(over: Partial<Shortcut>): Shortcut {
  return { id: "x", path: "a.ts", scope: "project", order: 0, ...over } as Shortcut;
}

test("tag facet: a pin carrying the active tag matches", () => {
  assert.equal(
    shortcutMatchesFilter(shortcut({ tags: ["ops", "dev"] }), { tag: "ops" }, false),
    true
  );
});

test("tag facet: a pin without the active tag is hidden", () => {
  assert.equal(
    shortcutMatchesFilter(shortcut({ tags: ["dev"] }), { tag: "ops" }, false),
    false
  );
});

test("tag facet: an untagged pin is hidden by any tag mode", () => {
  // "Show only #ops" must collapse everything that is not #ops, including pins
  // that carry no tags at all — the whole point of a focus mode.
  assert.equal(shortcutMatchesFilter(shortcut({}), { tag: "ops" }, false), false);
});

test("tag facet: no tag set shows every pin", () => {
  assert.equal(shortcutMatchesFilter(shortcut({}), {}, false), true);
  assert.equal(shortcutMatchesFilter(shortcut({ tags: ["ops"] }), {}, false), true);
});

test("isFilterActive: a tag-only filter is active; an empty filter is not", () => {
  assert.equal(isFilterActive({ tag: "ops" }), true);
  assert.equal(isFilterActive({}), false);
});

test("tag facet composes with the kind facet (both must pass)", () => {
  // Files-only + #ops: a tagged file shortcut passes both; a tagged shell shortcut fails the
  // kind facet even though it carries the tag.
  const filter: ShortcutFilter = { kinds: ["file"], tag: "ops" };
  assert.equal(shortcutMatchesFilter(shortcut({ tags: ["ops"] }), filter, false), true);
  assert.equal(
    shortcutMatchesFilter(
      shortcut({ tags: ["ops"], action: { kind: "shell" } }),
      filter,
      false
    ),
    false
  );
});

// Unit tests for the runtime l10n lookup (key resolution + {token} interpolation +
// missing-key fallback). l10n is pure — it reads the bundled English catalog and
// substitutes placeholders — so it bundles and runs under node --test with no vscode
// host. The catalog itself (en.json) is the real one, so these assertions double as a
// guard that a handful of load-bearing keys still exist and still carry their tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { l10n } from "../i18n/l10n";

test("a plain key with no placeholders returns the catalog value verbatim", () => {
  // "import.promptAction" is a fixed label with no {token}; it must come back unchanged.
  assert.equal(l10n("import.promptAction"), "Import");
});

test("a {token} placeholder is replaced by the matching param", () => {
  // "pin.added" is "Pinned {name}"; the name fills the single placeholder.
  assert.equal(l10n("pin.added", { name: "server.ts" }), "Pinned server.ts");
});

test("multiple distinct placeholders are each replaced", () => {
  // "import.log.summary" carries {added} and {skipped}; both fill independently.
  assert.equal(
    l10n("import.log.summary", { added: 3, skipped: 1 }),
    "[Import] Done: 3 added, 1 skipped."
  );
});

test("the same placeholder appearing twice is replaced at every occurrence", () => {
  // "depends.blocked" is "{name} is waiting on {dep}. Run {dep} successfully first." —
  // {dep} appears twice, so split/join must substitute BOTH, not just the first.
  assert.equal(
    l10n("depends.blocked", { name: "deploy", dep: "build" }),
    "deploy is waiting on build. Run build successfully first."
  );
});

test("a numeric param is stringified before substitution", () => {
  // Params are typed string | number; a number must render as its decimal text so
  // count-style strings ("Imported {count} pin(s)") read correctly.
  assert.equal(l10n("import.done", { count: 5, file: ".favorites.json" }), "Imported 5 pin(s) from .favorites.json.");
});

test("a missing key falls back to the key itself so a typo is visible, not empty", () => {
  // The fallback is deliberate: an unknown key surfaces as its own name rather than
  // an empty string, so a mistyped key is caught in the UI instead of silently blank.
  assert.equal(l10n("this.key.does.not.exist"), "this.key.does.not.exist");
});

test("a missing key still runs interpolation over its key-name fallback", () => {
  // When the key is absent the fallback value IS the key string itself, and the
  // interpolation pass still runs over it. A key containing a literal "{name}"
  // therefore has that token substituted, so "nope.{name}" becomes "nope.x" — a
  // realistic missing key (no braces) comes back unchanged, asserted below.
  assert.equal(l10n("nope.{name}", { name: "x" }), "nope.x");
  assert.equal(l10n("import.missing.key", { name: "x" }), "import.missing.key");
});

test("a placeholder with no matching param is left literal", () => {
  // "pin.added" needs {name}; calling with an empty/foreign param leaves {name} in
  // place rather than emptying it, so a missing argument is visible, not silent.
  assert.equal(l10n("pin.added", { other: "y" }), "Pinned {name}");
});

test("calling with no params returns a value that still contains its placeholders", () => {
  // With params undefined the interpolation loop is skipped entirely; the raw value
  // (placeholders intact) is returned, which is the correct no-op behavior.
  assert.equal(l10n("pin.added"), "Pinned {name}");
});

test("an empty-string param replaces the placeholder with nothing", () => {
  // recipe.desc.url is "Opens {url}"; an empty url collapses to "Opens ".
  assert.equal(l10n("recipe.desc.url", { url: "" }), "Opens ");
});

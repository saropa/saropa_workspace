// Unit tests for the pubspec dependency-freshness report renderer. buildOutdatedMarkdown
// is pure (given the already-filtered stale packages, produce the Markdown), so it runs
// under the built-in runner with the vscode stub — no `dart pub` process. The filter
// itself (isStale, driven by `dart pub outdated --json`) needs a real dart toolchain, so
// it is exercised manually, not here; these assertions pin the report shape the bug asked
// for: only out-of-date items, an explicit all-clear, and discontinued flagged inline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutdatedMarkdown, isStale } from "../exec/pubspecOutdated";

// isStale is the core of report-bug item 4: keep only the packages the user can act
// on. These pin the filter directly (the "only out-of-date items" contract), since
// collectOutdated itself needs a real dart toolchain and is exercised manually.
test("isStale keeps a package whose current version trails latest", () => {
  assert.equal(
    isStale({ package: "args", current: { version: "2.4.0" }, latest: { version: "2.5.0" } }),
    true
  );
});

test("isStale drops a package already at latest", () => {
  assert.equal(
    isStale({ package: "meta", current: { version: "1.10.0" }, latest: { version: "1.10.0" } }),
    false
  );
});

test("isStale drops a package with no current (not installed) or no latest (unknown)", () => {
  assert.equal(isStale({ package: "x", current: null, latest: { version: "1.0.0" } }), false);
  assert.equal(isStale({ package: "y", current: { version: "1.0.0" }, latest: null }), false);
  assert.equal(isStale({ package: "z", current: { version: null }, latest: { version: "1.0.0" } }), false);
});

test("isStale always surfaces a discontinued package, even at latest", () => {
  assert.equal(
    isStale({
      package: "dead",
      isDiscontinued: true,
      current: { version: "1.0.0" },
      latest: { version: "1.0.0" },
    }),
    true
  );
});

test("an all-current project renders an explicit all-clear, not an empty file", () => {
  const md = buildOutdatedMarkdown([]);
  assert.match(md, /# Pubspec dependency freshness/);
  assert.match(md, /All dependencies are up to date\./);
  // No table is emitted when nothing is behind.
  assert.doesNotMatch(md, /\| Package \|/);
});

test("only the out-of-date packages appear, one row each", () => {
  const md = buildOutdatedMarkdown([
    {
      name: "args",
      kind: "direct",
      current: "2.4.0",
      upgradable: "2.4.2",
      resolvable: "2.4.2",
      latest: "2.5.0",
      discontinued: false,
    },
    {
      name: "meta",
      kind: "transitive",
      current: "1.9.0",
      upgradable: "1.9.1",
      resolvable: "1.9.1",
      latest: "1.10.0",
      discontinued: false,
    },
  ]);
  assert.match(md, /2 package\(s\) behind latest\./);
  assert.match(md, /\| Package \| Kind \| Current \| Upgradable \| Resolvable \| Latest \|/);
  assert.match(md, /\| args \| direct \| 2\.4\.0 \| 2\.4\.2 \| 2\.4\.2 \| 2\.5\.0 \|/);
  assert.match(md, /\| meta \| transitive \| 1\.9\.0 \| 1\.9\.1 \| 1\.9\.1 \| 1\.10\.0 \|/);
});

test("a discontinued package is flagged inline", () => {
  const md = buildOutdatedMarkdown([
    {
      name: "old_pkg",
      kind: "direct",
      current: "1.0.0",
      upgradable: "1.0.0",
      resolvable: "1.0.0",
      latest: "1.0.0",
      discontinued: true,
    },
  ]);
  assert.match(md, /old_pkg \(discontinued\)/);
});

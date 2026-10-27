// Status light tooltip: the light in words, the notes in order, the plain tooltip last.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lightTooltip } from "../../commands/boardStatusLight";
import { l10n } from "../../i18n/l10n";

test("with no light the tooltip is the plain one", () => {
  assert.equal(lightTooltip(undefined, "old", ["x"], "plain"), "plain");
});

test("a light adds its name first and the plain tooltip last", () => {
  const lines = lightTooltip("no-go", undefined, [], "plain").split("\n");
  assert.deepEqual(lines, [l10n("releaseBoard.panel.noGo"), "plain"]);
});

test("the stale note and the since-last lines sit between them, in order", () => {
  const lines = lightTooltip("go", "stale", ["heading", "one change"], "plain").split("\n");
  assert.deepEqual(lines, [l10n("releaseBoard.panel.go"), "stale", "heading", "one change", "plain"]);
});

test("each light has its own words", () => {
  const words = (["no-go", "unverified", "go"] as const).map((l) => lightTooltip(l, undefined, [], "p"));
  assert.equal(new Set(words).size, 3);
});

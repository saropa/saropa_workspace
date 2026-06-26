// Unit tests for kindIcon (pinRowTokens.ts) — the default codicon glyph per non-file
// action kind. This is the one pure, host-free export in the row-token module: it maps
// a PinKind to a codicon id (a plain string) and touches no VS Code API. The module's
// other export, resolvePinRowIcon, constructs vscode.ThemeIcon / vscode.ThemeColor,
// which the test stub does not model, so it is exercised through the extension host
// rather than here; importing the module for kindIcon is safe because the ThemeIcon
// references live only inside resolvePinRowIcon's body and are never evaluated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { kindIcon } from "../views/pinRowTokens";
import { PinKind } from "../model/pin";

test("kindIcon: each non-file action kind maps to its dedicated glyph", () => {
  // These are the single source of truth for the tree's row glyphs, so the mapping is
  // pinned exactly: a silent change would shift the visual language for that kind.
  assert.equal(kindIcon("url"), "link-external");
  assert.equal(kindIcon("shell"), "terminal");
  assert.equal(kindIcon("command"), "symbol-event");
  assert.equal(kindIcon("macro"), "list-ordered");
  // A routine runs a block of recipes back-to-back, so it reads as "run all" rather
  // than a single task.
  assert.equal(kindIcon("routine"), "run-all");
});

test("kindIcon: an unmapped kind falls back to the generic pin glyph", () => {
  // "file" and the annotation kinds (comment/separator) are handled by the caller
  // before kindIcon is consulted, so they hit the default arm and read as a plain
  // pin rather than producing an empty / undefined glyph.
  assert.equal(kindIcon("file"), "pin");
  assert.equal(kindIcon("comment"), "pin");
  assert.equal(kindIcon("separator"), "pin");
});

test("kindIcon: always returns a non-empty codicon id", () => {
  // Every PinKind must yield a usable glyph; an empty string would render no icon and
  // leave the row visually broken. Sweep the full union to guarantee total coverage.
  const kinds: PinKind[] = [
    "file",
    "shell",
    "url",
    "command",
    "macro",
    "routine",
    "comment",
    "separator",
  ];
  for (const kind of kinds) {
    const glyph = kindIcon(kind);
    assert.ok(typeof glyph === "string" && glyph.length > 0, `empty glyph for "${kind}"`);
  }
});

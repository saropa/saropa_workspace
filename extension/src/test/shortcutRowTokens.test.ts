// Unit tests for kindIcon (shortcutRowTokens.ts) — the default codicon glyph per non-file
// action kind. This is the one pure, host-free export in the row-token module: it maps
// a ShortcutKind to a codicon id (a plain string) and touches no VS Code API. The module's
// other export, resolveShortcutRowIcon, constructs vscode.ThemeIcon / vscode.ThemeColor,
// which the test stub does not model, so it is exercised through the extension host
// rather than here; importing the module for kindIcon is safe because the ThemeIcon
// references live only inside resolveShortcutRowIcon's body and are never evaluated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { kindIcon, fileTypeIcon } from "../views/shortcutRowTokens";
import { ShortcutKind } from "../model/shortcut";

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
  // shortcut rather than producing an empty / undefined glyph.
  assert.equal(kindIcon("file"), "pin");
  assert.equal(kindIcon("comment"), "pin");
  assert.equal(kindIcon("separator"), "pin");
});

test("kindIcon: always returns a non-empty codicon id", () => {
  // Every ShortcutKind must yield a usable glyph; an empty string would render no icon and
  // leave the row visually broken. Sweep the full union to guarantee total coverage.
  const kinds: ShortcutKind[] = [
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

test("fileTypeIcon: common extensions map to a glyph + chart tint", () => {
  // The default file-type glyphs are the visual language for a resting file shortcut, so
  // the key cases are pinned: a silent change would shift what ".yaml" or ".dart" reads as.
  assert.deepEqual(fileTypeIcon("pubspec.yaml"), { icon: "settings-gear", color: "charts.purple" });
  assert.deepEqual(fileTypeIcon("main.dart"), { icon: "symbol-class", color: "charts.blue" });
  assert.deepEqual(fileTypeIcon("package.json"), { icon: "json", color: "charts.yellow" });
  assert.deepEqual(fileTypeIcon("setup.py"), { icon: "snake", color: "charts.blue" });
});

test("fileTypeIcon: the LAST dot decides the extension", () => {
  // A compound name like "widget.test.ts" must key on "ts", not "test", so multi-part
  // filenames still resolve to their real type.
  assert.equal(fileTypeIcon("widget.test.ts")?.icon, "file-code");
});

test("fileTypeIcon: exact-name files win over a bare extension lookup", () => {
  // VS Code recognizes these by name, not extension; an exact-name match must be tried
  // first so "Dockerfile" (no extension) and "LICENSE" land on a meaningful glyph.
  assert.deepEqual(fileTypeIcon("Dockerfile"), { icon: "vm", color: "charts.blue" });
  assert.deepEqual(fileTypeIcon("LICENSE"), { icon: "law", color: "charts.yellow" });
  assert.deepEqual(fileTypeIcon(".gitignore"), { icon: "git-commit", color: "charts.foreground" });
});

test("fileTypeIcon: matching is case-insensitive", () => {
  // Targets arrive with whatever case the filesystem reports; an uppercase extension
  // must still resolve so "README.MD" reads the same as "readme.md".
  assert.equal(fileTypeIcon("README.MD")?.icon, "markdown");
});

test("fileTypeIcon: an unmapped or extension-less name returns undefined", () => {
  // The caller falls back to the generic pin/star for these, so nothing regresses for a
  // file type the map does not cover.
  assert.equal(fileTypeIcon("notes.xyz"), undefined);
  assert.equal(fileTypeIcon("Makefile.unknownext"), undefined);
  assert.equal(fileTypeIcon(undefined), undefined);
});

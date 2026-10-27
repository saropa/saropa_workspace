// Unit tests for the file-type and shortcut-kind icon/color lookup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileTypeIcon, kindIcon, kindColor } from "../views/fileTypeTokens";

test("fileTypeIcon matches well-known names case-insensitively", () => {
  assert.equal(fileTypeIcon("Dockerfile")?.icon, "vm");
  assert.equal(fileTypeIcon("MAKEFILE")?.icon, "settings-gear");
  assert.equal(fileTypeIcon(".gitignore")?.icon, "git-commit");
  assert.equal(fileTypeIcon("LICENSE.md")?.icon, "law");
});

test("fileTypeIcon resolves by extension, using the last dot", () => {
  assert.deepEqual(fileTypeIcon("main.dart"), { icon: "symbol-class", color: "charts.blue" });
  assert.equal(fileTypeIcon("a.b.c.PY")?.icon, "snake");
  assert.equal(fileTypeIcon("archive.tar.json")?.icon, "json");
});

test("fileTypeIcon returns undefined for unknown, extensionless or dotfile-only names", () => {
  assert.equal(fileTypeIcon("file.unknownext"), undefined);
  assert.equal(fileTypeIcon("noextension"), undefined);
  assert.equal(fileTypeIcon(".env"), undefined);
  assert.equal(fileTypeIcon(""), undefined);
  assert.equal(fileTypeIcon(undefined), undefined);
});

test("kindIcon and kindColor cover each runnable kind and fall back for the rest", () => {
  assert.equal(kindIcon("url"), "link-external");
  assert.equal(kindIcon("shell"), "terminal");
  assert.equal(kindIcon("command"), "symbol-event");
  assert.equal(kindIcon("macro"), "list-ordered");
  assert.equal(kindIcon("routine"), "run-all");
  assert.equal(kindIcon("file"), "pin");
  assert.equal(kindColor("url"), "charts.blue");
  assert.equal(kindColor("shell"), "charts.green");
  assert.equal(kindColor("command"), "charts.purple");
  assert.equal(kindColor("macro"), "charts.orange");
  assert.equal(kindColor("routine"), "charts.yellow");
  assert.equal(kindColor("file"), "charts.foreground");
});

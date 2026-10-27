// Unit tests for the Files-pane launcher row builder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileLauncherItem } from "../views/launcherFileItem";

const input = {
  path: "/p/src/app.ts",
  fileName: "app.ts",
  relative: "2h ago",
  isShortcut: false,
  category: "Source",
  categoryGlyph: "code",
};

test("builds an openable, non-runnable file row with the type icon", () => {
  const item = fileLauncherItem(input);
  assert.equal(item.id, "/p/src/app.ts");
  assert.equal(item.label, "app.ts");
  assert.equal(item.desc, "/p/src/app.ts");
  assert.equal(item.icon, "file-code");
  assert.equal(item.pane, "files");
  assert.equal(item.groupId, "files:Source");
  assert.equal(item.runnable, false);
  assert.equal(item.openable, true);
  assert.deepEqual(item.menu, []);
});

test("sub line is the relative time, versioned and pinned variants extend it", () => {
  assert.equal(fileLauncherItem(input).sub, "2h ago");
  assert.equal(fileLauncherItem({ ...input, version: "1.2.3" }).sub, "v1.2.3 · 2h ago");
  assert.equal(fileLauncherItem({ ...input, isShortcut: true }).sub, "2h ago · shortcut");
  assert.equal(fileLauncherItem({ ...input, version: "2", isShortcut: true }).sub, "v2 · 2h ago · shortcut");
});

test("an unknown file type falls back to the generic file icon", () => {
  const item = fileLauncherItem({ ...input, fileName: "mystery.zzz" });
  assert.equal(item.icon, "file");
  assert.equal(item.color, "charts.foreground");
});

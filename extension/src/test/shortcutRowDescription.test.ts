// Unit tests for buildShortcutRowDescription (shortcutRowDescription.ts). The
// function is pure (every input explicit, no live store), so it runs under
// Node's built-in runner with the vscode stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShortcutRowDescription,
  ShortcutRowDescriptionInput,
} from "../views/shortcutRowDescription";
import { Shortcut } from "../model/shortcut";

function shortcut(over: Partial<Shortcut>): Shortcut {
  return { id: "x", path: "src/app.ts", scope: "project", order: 0, ...over } as Shortcut;
}

function input(over: Partial<ShortcutRowDescriptionInput>): ShortcutRowDescriptionInput {
  return {
    shortcut: shortcut({}),
    masked: false,
    isFile: true,
    isRunning: false,
    isStopping: false,
    lastRun: undefined,
    lockedBy: undefined,
    sweepBadge: undefined,
    metricBadge: undefined,
    recentInfo: undefined,
    previousBadge: undefined,
    owningFolder: undefined,
    ...over,
  };
}

// --- owningFolder attribution -------------------------------------------

test("description includes folder tag when owningFolder is set", () => {
  const result = buildShortcutRowDescription(input({ owningFolder: "backend" }));
  const parts = result.description.split(" · ");
  assert.ok(
    parts.some((p) => p === "in backend"),
    `expected "in backend" segment in "${result.description}"`
  );
});

test("description omits folder tag when owningFolder is undefined", () => {
  const result = buildShortcutRowDescription(input({ owningFolder: undefined }));
  const parts = result.description.split(" · ");
  assert.ok(
    !parts.some((p) => p.startsWith("in ")),
    `unexpected folder segment in "${result.description}"`
  );
});

test("folder tag appears after the file path segment", () => {
  const result = buildShortcutRowDescription(input({ owningFolder: "api" }));
  const parts = result.description.split(" · ");
  // detail shows only the parent directory ("src"), not the full path
  const pathIdx = parts.findIndex((p) => p === "src");
  const folderIdx = parts.findIndex((p) => p === "in api");
  assert.ok(pathIdx >= 0, "path segment missing");
  assert.ok(folderIdx >= 0, "folder segment missing");
  assert.ok(
    folderIdx > pathIdx,
    `folder tag (idx ${folderIdx}) should follow path (idx ${pathIdx})`
  );
});

// --- file path detail (directory-only) ------------------------------------

test("nested file shows parent directory only, not the full path", () => {
  const result = buildShortcutRowDescription(input({}));
  const parts = result.description.split(" · ");
  assert.ok(
    parts.includes("src"),
    `expected "src" directory segment in "${result.description}"`
  );
  assert.ok(
    !parts.includes("src/app.ts"),
    `full path should not appear in "${result.description}"`
  );
});

test("root-level file with no custom label shows no path detail", () => {
  const result = buildShortcutRowDescription(
    input({ shortcut: shortcut({ path: "pubspec.yaml" }) })
  );
  assert.strictEqual(result.description, "");
});

test("custom label shows the full path, not just the directory", () => {
  const result = buildShortcutRowDescription(
    input({ shortcut: shortcut({ label: "My Config", path: "src/app.ts" }) })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    parts.includes("src/app.ts"),
    `expected full path with custom label in "${result.description}"`
  );
});

test("deeply nested path shows full parent directory chain", () => {
  const result = buildShortcutRowDescription(
    input({ shortcut: shortcut({ path: "lib/src/views/components/widget.ts" }) })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    parts.includes("lib/src/views/components"),
    `expected full parent directory in "${result.description}"`
  );
});

// --- badge delta on row ---------------------------------------------------

test("description includes delta when sweepBadge and previousBadge differ", () => {
  const result = buildShortcutRowDescription(
    input({
      sweepBadge: { errors: 2, warnings: 0, infos: 0, at: 1 },
      previousBadge: { errors: 5, warnings: 0, infos: 0, at: 0 },
    })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    parts.some((p) => p === "▼3"),
    `expected "▼3" delta in "${result.description}"`
  );
});

test("description omits delta when no previousBadge", () => {
  const result = buildShortcutRowDescription(
    input({
      sweepBadge: { errors: 2, warnings: 0, infos: 0, at: 1 },
    })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    !parts.some((p) => p.startsWith("▲") || p.startsWith("▼")),
    `unexpected delta in "${result.description}"`
  );
});

test("description omits delta while running", () => {
  const result = buildShortcutRowDescription(
    input({
      isRunning: true,
      sweepBadge: { errors: 2, warnings: 0, infos: 0, at: 1 },
      previousBadge: { errors: 5, warnings: 0, infos: 0, at: 0 },
    })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    !parts.some((p) => p.startsWith("▲") || p.startsWith("▼")),
    `delta should be suppressed while running: "${result.description}"`
  );
});

test("masked shortcut suppresses delta even with badges", () => {
  const result = buildShortcutRowDescription(
    input({
      masked: true,
      sweepBadge: { errors: 2, warnings: 0, infos: 0, at: 1 },
      previousBadge: { errors: 5, warnings: 0, infos: 0, at: 0 },
    })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    !parts.some((p) => p.startsWith("▲") || p.startsWith("▼")),
    `masked shortcut should not leak delta: "${result.description}"`
  );
});

test("masked shortcut suppresses folder tag even when owningFolder is set", () => {
  const result = buildShortcutRowDescription(
    input({ owningFolder: "secret-project", masked: true })
  );
  const parts = result.description.split(" · ");
  assert.ok(
    !parts.some((p) => p.startsWith("in ")),
    `masked shortcut should not leak folder: "${result.description}"`
  );
});

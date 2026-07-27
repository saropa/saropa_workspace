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
    owningFolder: undefined,
    ...over,
  };
}

// --- owningFolder attribution -------------------------------------------

test("description includes folder tag when owningFolder is set", () => {
  const result = buildShortcutRowDescription(input({ owningFolder: "backend" }));
  assert.ok(
    result.description.includes("in backend"),
    `expected folder tag in "${result.description}"`
  );
});

test("description omits folder tag when owningFolder is undefined", () => {
  const result = buildShortcutRowDescription(input({ owningFolder: undefined }));
  assert.ok(
    !result.description.includes("in "),
    `unexpected folder tag in "${result.description}"`
  );
});

test("folder tag appears after the file path segment", () => {
  const result = buildShortcutRowDescription(input({ owningFolder: "api" }));
  const parts = result.description.split(" · ");
  const pathIdx = parts.findIndex((p) => p === "src/app.ts");
  const folderIdx = parts.findIndex((p) => p.includes("in api"));
  assert.ok(pathIdx >= 0, "path segment missing");
  assert.ok(folderIdx >= 0, "folder segment missing");
  assert.ok(
    folderIdx > pathIdx,
    `folder tag (idx ${folderIdx}) should follow path (idx ${pathIdx})`
  );
});

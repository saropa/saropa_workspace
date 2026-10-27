// Tests for the folder-watch model helpers that the store tests do not reach: the
// path containment rule, the global flag, and the kind / mode labels and icon.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGlobalWatch,
  isPathInside,
  watchBaseIcon,
  watchKindLabel,
  watchModeLabel,
  type FolderWatch,
} from "../model/folderWatchModel";

function watch(extra: Partial<FolderWatch> = {}): FolderWatch {
  return { id: "w", target: "/p/dir", isFile: false, mode: "new", enabled: true, ...extra };
}

test("a path is inside its own folder and any descendant, not a sibling or parent", () => {
  assert.equal(isPathInside("/p", "/p"), true);
  assert.equal(isPathInside("/p", "/p/a/b.txt"), true);
  assert.equal(isPathInside("/p/a", "/p/b"), false);
  assert.equal(isPathInside("/p/a", "/p"), false);
});

test("a folder whose name merely starts with the other's name is not inside it", () => {
  assert.equal(isPathInside("/p/app", "/p/app-two/x.ts"), false);
});

test("only an explicit global flag makes a watch global", () => {
  assert.equal(isGlobalWatch(watch()), false);
  assert.equal(isGlobalWatch(watch({ global: false })), false);
  assert.equal(isGlobalWatch(watch({ global: true })), true);
});

test("the kind label tells a repo, a file and a folder apart", () => {
  assert.equal(watchKindLabel(watch({ kind: "repo" })), "repo");
  assert.equal(watchKindLabel(watch({ isFile: true })), "file");
  assert.equal(watchKindLabel(watch()), "folder");
});

test("the mode label follows the kind first, then the mode", () => {
  assert.equal(watchModeLabel(watch({ kind: "repo", mode: "changed" })), "new issues & PRs");
  assert.equal(watchModeLabel(watch({ mode: "changed" })), "New and changed files");
  assert.equal(watchModeLabel(watch({ mode: "new" })), "Only new files");
});

test("a repo watch uses the GitHub icon and everything else the eye", () => {
  assert.equal(watchBaseIcon(watch({ kind: "repo" })), "github");
  assert.equal(watchBaseIcon(watch({ kind: "folder" })), "eye");
  assert.equal(watchBaseIcon(watch()), "eye");
});

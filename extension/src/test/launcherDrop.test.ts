// Unit tests for the launcher's drag-drop routing (applyGroupDrop in
// launcherViewMessages.ts). The webview offers the drop only where it means something, but
// its payload is untrusted, so the host re-resolves the target and the dropped card and
// re-decides what may be filed where. These tests drive handleLauncherMessage with
// `dropOnGroup` and `dropOnCard` messages against a fake store / project-files provider and
// assert which command or store mutation the host actually ran.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  Uri,
  __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { handleLauncherMessage, LauncherMessageContext } from "../views/launcherViewMessages";
import { Shortcut } from "../model/shortcut";
import { MoveTarget } from "../model/shortcutStore";

// A stored file shortcut: `path` is folder-relative, which is why the host resolves the
// absolute uri through the store rather than trusting the stored string.
const fileShortcut: Shortcut = {
  id: "sc-file",
  path: "scripts/deploy.sh",
  scope: "project",
  order: 0,
};

// A detected (un-adopted) recipe. Dropping it on My shortcuts must ADOPT it, not pin its file.
const recipe: Shortcut = {
  id: "sc-recipe",
  path: "scripts/nightly.sh",
  scope: "project",
  order: 1,
  isRecipe: true,
};

// A shell action: no file on disk, so it can be neither pinned by path nor watched. The kind
// comes from `action`, NOT from `exec` — an `exec` block is a run config that a plain FILE
// shortcut also carries, so keying the guard off it would classify most file shortcuts as
// actions (shortcutKind reads action?.kind, defaulting to "file").
const shellShortcut: Shortcut = {
  id: "sc-shell",
  path: "",
  scope: "project",
  order: 2,
  action: { kind: "shell", shellCommand: "npm run build" },
};

const SURFACED_FILE = "/repo/pubspec.yaml";

let movedShortcuts: { shortcuts: Shortcut[]; target: MoveTarget }[] = [];

function context(): LauncherMessageContext {
  const byId = new Map<string, Shortcut>([
    [fileShortcut.id, fileShortcut],
    [recipe.id, recipe],
    [shellShortcut.id, shellShortcut],
  ]);
  const store = {
    findShortcut: (id: string): Shortcut | undefined => byId.get(id),
    resolveUri: (s: Shortcut): unknown => Uri.file("/repo/" + s.path),
    moveShortcuts: async (shortcuts: Shortcut[], target: MoveTarget): Promise<void> => {
      movedShortcuts.push({ shortcuts, target });
    },
  };
  const projectFiles = {
    listSurfacedFiles: async (): Promise<unknown[]> => [
      { uri: Uri.file(SURFACED_FILE), name: "pubspec.yaml" },
    ],
  };
  return {
    store,
    projectFiles,
    watchStore: {},
    scriptsProvider: {},
    extensionPath: "/ext",
    globalState: fakeContext().globalState,
    post: async (): Promise<void> => {},
  } as unknown as LauncherMessageContext;
}

beforeEach(() => {
  __resetRecordedCommands();
  movedShortcuts = [];
});

// --- dropOnGroup (card dragged between groups within a pane) ---------

async function dropOnGroup(groupId: string, id: string): Promise<void> {
  await handleLauncherMessage({ type: "dropOnGroup", groupId, id }, context());
}

test("a shortcut dropped on a group moves it into that group", async () => {
  await dropOnGroup("project:grp-deploy", fileShortcut.id);
  assert.equal(movedShortcuts.length, 1);
  assert.equal(movedShortcuts[0].shortcuts[0], fileShortcut);
  assert.deepEqual(movedShortcuts[0].target, {
    scope: "project",
    groupId: "grp-deploy",
    beforeShortcutId: undefined,
  });
});

test("a shortcut dropped on a bare scope root ungroups it", async () => {
  await dropOnGroup("project", fileShortcut.id);
  assert.equal(movedShortcuts.length, 1);
  assert.deepEqual(movedShortcuts[0].target, {
    scope: "project",
    groupId: undefined,
    beforeShortcutId: undefined,
  });
});

test("a recipe dropped on a group is rejected", async () => {
  await dropOnGroup("project:grp-deploy", recipe.id);
  assert.equal(movedShortcuts.length, 0);
});

test("a cross-scope group drop is rejected", async () => {
  await dropOnGroup("global:grp-deploy", fileShortcut.id);
  assert.equal(movedShortcuts.length, 0);
});

test("an unknown card id in a group drop does nothing", async () => {
  await dropOnGroup("project:grp-deploy", "does-not-exist");
  assert.equal(movedShortcuts.length, 0);
});

test("an invalid scope in a group drop does nothing", async () => {
  await dropOnGroup("invalid:grp-deploy", fileShortcut.id);
  assert.equal(movedShortcuts.length, 0);
});

// --- dropOnCard (card dropped on another card for reorder) -----------

async function dropOnCard(groupId: string, targetId: string, id: string): Promise<void> {
  await handleLauncherMessage({ type: "dropOnCard", groupId, targetId, id }, context());
}

test("a card dropped on another card moves it before the target in the target's group", async () => {
  await dropOnCard("project:grp-deploy", shellShortcut.id, fileShortcut.id);
  assert.equal(movedShortcuts.length, 1);
  assert.equal(movedShortcuts[0].shortcuts[0], fileShortcut);
  assert.deepEqual(movedShortcuts[0].target, {
    scope: "project",
    groupId: "grp-deploy",
    beforeShortcutId: shellShortcut.id,
  });
});

test("a card dropped on a top-level card ungroups it and inserts before the target", async () => {
  await dropOnCard("project", shellShortcut.id, fileShortcut.id);
  assert.equal(movedShortcuts.length, 1);
  assert.deepEqual(movedShortcuts[0].target, {
    scope: "project",
    groupId: undefined,
    beforeShortcutId: shellShortcut.id,
  });
});

test("a recipe dropped on a card is rejected", async () => {
  await dropOnCard("project:grp-deploy", fileShortcut.id, recipe.id);
  assert.equal(movedShortcuts.length, 0);
});

test("a cross-scope card drop is rejected", async () => {
  await dropOnCard("global:grp-deploy", shellShortcut.id, fileShortcut.id);
  assert.equal(movedShortcuts.length, 0);
});

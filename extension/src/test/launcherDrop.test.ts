// Unit tests for the launcher's drag-drop routing (applyPaneDrop and applyGroupDrop in
// launcherViewMessages.ts). The webview offers the drop only where it means something, but
// its payload is untrusted, so the host re-resolves the target and the dropped card and
// re-decides what may be filed where. These tests drive handleLauncherMessage with
// `dropOnPane` and `dropOnGroup` messages against a fake store / project-files provider and
// assert which command or store mutation the host actually ran.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  Uri,
  __recordedCommands,
  __resetRecordedCommands,
} from "./_stub/vscode";
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
    post: async (): Promise<void> => {},
  } as unknown as LauncherMessageContext;
}

async function drop(pane: string, id: string): Promise<void> {
  await handleLauncherMessage({ type: "dropOnPane", pane, id }, context());
}

// The command ids the host ran, in order.
function ran(): string[] {
  return __recordedCommands().map((c) => c.command);
}

beforeEach(() => {
  __resetRecordedCommands();
  movedShortcuts = [];
});

test("a recipe dropped on My shortcuts is adopted, not pinned by path", async () => {
  // promoteRecipe converts the detected entry into a stored shortcut AND suppresses the
  // detection. Pinning its file would leave the recipe still showing in the Recipes pane, so
  // the recipe branch must be checked BEFORE the file branch.
  await drop("mine", recipe.id);
  assert.deepEqual(ran(), ["saropaWorkspace.promoteRecipe"]);
  assert.equal(__recordedCommands()[0].args[0], recipe, "the re-resolved shortcut is passed");
});

test("a surfaced project file dropped on My shortcuts is pinned by its validated uri", async () => {
  // A project-file card's id IS its absolute path. The host must re-validate it against the
  // live scan rather than trusting the webview, so the pinned uri comes from the scan result.
  await drop("mine", SURFACED_FILE);
  assert.deepEqual(ran(), ["saropaWorkspace.pinFile"]);
  const uri = __recordedCommands()[0].args[0] as { fsPath: string };
  assert.equal(uri.fsPath, SURFACED_FILE);
});

test("a file shortcut dropped on Watches is watched at its resolved absolute path", async () => {
  // The stored path is folder-relative; watchFile needs the absolute uri, which only
  // store.resolveUri can produce.
  await drop("watches", fileShortcut.id);
  assert.deepEqual(ran(), ["saropaWorkspace.watchFile"]);
  const uri = __recordedCommands()[0].args[0] as { fsPath: string };
  assert.equal(uri.fsPath, "/repo/scripts/deploy.sh");
});

test("a shell action has no file, so it can be neither pinned nor watched", async () => {
  // The webview never offers this drop (canDropOnPane gates on the card being file-backed),
  // but a spoofed message must fall through to nothing rather than run a command with an
  // undefined target.
  await drop("watches", shellShortcut.id);
  await drop("mine", shellShortcut.id);
  assert.deepEqual(ran(), []);
});

test("a card dropped on a derived section does nothing", async () => {
  // Recipes, Project files and Scripts are produced by detection or by a disk scan — there is
  // no such thing as filing something INTO them, so every drop on those pills is inert even
  // if the webview were made to post one.
  for (const pane of ["recipes", "files", "scripts", "nonsense"]) {
    await drop(pane, fileShortcut.id);
  }
  assert.deepEqual(ran(), []);
});

test("an unknown card id resolves to nothing and runs no command", async () => {
  // A stale payload (the card was removed between the drag starting and the drop landing)
  // must not fall back to some other target.
  await drop("mine", "does-not-exist");
  await drop("watches", "does-not-exist");
  assert.deepEqual(ran(), []);
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

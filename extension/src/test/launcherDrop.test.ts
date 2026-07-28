// Unit tests for the launcher's drag-a-card-onto-a-folded-section drop routing
// (applyPaneDrop in launcherViewMessages.ts). The webview offers the drop only where it means
// something, but its payload is untrusted, so the host re-resolves both the target section and
// the dropped card and re-decides what may be filed where. These tests drive
// handleLauncherMessage with a `dropOnPane` message against a fake store / project-files
// provider and assert which command the host actually ran — the layer where a spoofed or
// stale payload has to be rejected.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  Uri,
  __recordedCommands,
  __resetRecordedCommands,
} from "./_stub/vscode";
import { handleLauncherMessage, LauncherMessageContext } from "../views/launcherViewMessages";
import { Shortcut } from "../model/shortcut";

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

function context(): LauncherMessageContext {
  const byId = new Map<string, Shortcut>([
    [fileShortcut.id, fileShortcut],
    [recipe.id, recipe],
    [shellShortcut.id, shellShortcut],
  ]);
  const store = {
    findShortcut: (id: string): Shortcut | undefined => byId.get(id),
    resolveUri: (s: Shortcut): unknown => Uri.file("/repo/" + s.path),
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

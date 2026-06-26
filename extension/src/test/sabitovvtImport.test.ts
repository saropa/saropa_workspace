// Mapping + idempotency tests for the sabitovvt "Favorites Panel" importer (roadmap
// "additional import formats" — the sabitovvt slice). These run the REAL importer
// against the REAL ShortcutStore via the fs-backed vscode stub, driving the
// `favoritesPanel.commands` settings key and the `favoritesPanel.configPath` custom
// file. They cover every command->shortcut mapping (openFile/run/runCommand url+command),
// sequence->macro all-or-nothing, the insertNewCode/unknown skip, icon/color
// carry-over, action-shortcut dedup, and the custom-file array + legacy-wrapper shapes.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import {
  importSabitovvtFavorites,
  detectSabitovvtFavoritesCount,
} from "../import/favoritesSettings";
import type { Shortcut } from "../model/shortcut";

let tmpDir: string;
let folder: WorkspaceFolder;

// The action pins this import produced (file pins from openFile keep their path and
// carry no action, so filtering on `action` isolates the non-file mappings).
function actionShortcuts(store: ShortcutStore): Shortcut[] {
  return store.getProjectShortcuts().filter((p) => p.action !== undefined);
}

function findByLabel(store: ShortcutStore, label: string): Shortcut | undefined {
  return store.getProjectShortcuts().find((p) => p.label === label);
}

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a refresh exercises only store IO; recipes have their
  // own pure detector tests.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-sabitovvt-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// Install the global `favoritesPanel.commands` settings key (no config section, so
// the bare key matches how the importer reads it).
function setCommands(items: unknown[]): void {
  __setConfig("", "favoritesPanel.commands", items);
}

test("each command kind maps to its pin kind (openFile/run/runCommand url+command)", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  setCommands([
    { label: "Server", command: "openFile", arguments: ["api/server.ts"] },
    { label: "Test", command: "run", arguments: ["npm test"] },
    { label: "Repo", command: "runCommand", arguments: ["vscode.open", "https://example.com"] },
    { label: "Format", command: "runCommand", arguments: ["editor.action.format", "x"] },
  ]);

  const result = await importSabitovvtFavorites(store);
  assert.equal(result.added, 4, "all four items import");
  assert.equal(result.skipped, 0, "nothing is skipped");

  const file = findByLabel(store, "Server");
  assert.ok(file, "the openFile item is pinned");
  assert.equal(file!.action, undefined, "an openFile item becomes a plain file pin (no action)");
  assert.equal(file!.path, "api/server.ts", "the file pin stores the folder-relative path");

  const shell = findByLabel(store, "Test");
  assert.equal(shell?.action?.kind, "shell", "a run item becomes a shell pin");
  assert.equal(shell?.action?.shellCommand, "npm test");

  const url = findByLabel(store, "Repo");
  assert.equal(url?.action?.kind, "url", "runCommand vscode.open becomes a url pin");
  assert.equal(url?.action?.url, "https://example.com");

  const command = findByLabel(store, "Format");
  assert.equal(command?.action?.kind, "command", "any other runCommand becomes a command pin");
  assert.equal(command?.action?.commandId, "editor.action.format");
  assert.deepEqual(command?.action?.commandArgs, ["x"], "the remaining arguments are carried");
});

test("a sequence becomes a macro only when every step maps; one bad step skips it", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  setCommands([
    {
      label: "Boot",
      sequence: [
        { command: "openFile", arguments: ["a.ts"] },
        { command: "run", arguments: ["npm i"] },
      ],
    },
    {
      label: "Partial",
      // The insertNewCode step has no shortcut equivalent, so the WHOLE sequence skips
      // rather than silently dropping a step.
      sequence: [
        { command: "run", arguments: ["echo hi"] },
        { command: "insertNewCode", arguments: ["// snippet"] },
      ],
    },
  ]);

  const result = await importSabitovvtFavorites(store);
  assert.equal(result.added, 1, "only the fully-mappable sequence imports");
  assert.equal(result.skipped, 1, "the sequence with an unmappable step is skipped");

  const macro = findByLabel(store, "Boot");
  assert.equal(macro?.action?.kind, "macro", "a mappable sequence becomes a macro pin");
  assert.equal(macro?.action?.steps?.length, 2, "the macro has one step per command");
  assert.equal(macro?.action?.steps?.[0].kind, "open");
  assert.equal(macro?.action?.steps?.[1].kind, "shell");
  assert.equal(findByLabel(store, "Partial"), undefined, "the partial sequence produced no pin");
});

test("insertNewCode, unknown commands, and unlabeled items are reported and skipped", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  setCommands([
    { label: "Snippet", command: "insertNewCode", arguments: ["// x"] },
    { label: "Mystery", command: "doSomethingElse", arguments: ["y"] },
    { command: "run", arguments: ["npm test"] }, // no label
  ]);

  const result = await importSabitovvtFavorites(store);
  assert.equal(result.added, 0, "no unmappable/unlabeled item imports");
  assert.equal(result.skipped, 3, "all three are skipped");
  assert.equal(actionShortcuts(store).length, 0, "no action pin is created");
});

test("icon and iconColor are carried onto an action pin", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  setCommands([
    {
      label: "Build",
      icon: "rocket",
      iconColor: "charts.green",
      command: "run",
      arguments: ["npm run build"],
    },
  ]);

  await importSabitovvtFavorites(store);

  const shortcut = findByLabel(store, "Build");
  assert.equal(shortcut?.icon, "rocket", "the codicon id is carried over");
  assert.equal(shortcut?.color, "charts.green", "the theme-color id is carried over");
});

test("the same action listed twice imports once (idempotent within and across runs)", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  setCommands([
    { label: "Test", command: "run", arguments: ["npm test"] },
    { label: "Test", command: "run", arguments: ["npm test"] },
  ]);

  const first = await importSabitovvtFavorites(store);
  assert.equal(first.added, 1, "the duplicate within one run is collapsed");

  // A second whole import over the same settings adds nothing — the dedup is seeded
  // from existing project pins.
  const second = await importSabitovvtFavorites(store);
  assert.equal(second.added, 0, "re-running adds no duplicate");

  assert.equal(
    actionShortcuts(store).filter((p) => p.label === "Test").length,
    1,
    "exactly one shell pin exists"
  );
});

test("items in a configPath custom file import (top-level array shape)", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  // sabitovvt v1.4.0+ stores a bare array of items in the pointed-at file.
  const file = `${tmpDir}/custom-favorites.json`;
  nodeFs.writeFileSync(
    file,
    JSON.stringify([{ label: "Docs", command: "openFile", arguments: ["README.md"] }])
  );
  __setConfig("", "favoritesPanel.configPath", file);

  const count = await detectSabitovvtFavoritesCount();
  assert.equal(count, 1, "the custom-file item is counted by the import gate");

  const result = await importSabitovvtFavorites(store);
  assert.equal(result.added, 1, "the custom-file item imports");
  const shortcut = findByLabel(store, "Docs");
  assert.ok(shortcut, "the custom-file file pin is created");
  assert.equal(shortcut!.path, "README.md", "the path is stored folder-relative");
});

test("a configPath custom file in the legacy object-wrapper shape imports", async () => {
  const store = new ShortcutStore(fakeContext());
  await store.init();

  // Pre-1.3.0 stores the items under a "favoritesPanel.commands" key in the file.
  const file = `${tmpDir}/legacy-favorites.json`;
  nodeFs.writeFileSync(
    file,
    JSON.stringify({
      "favoritesPanel.commands": [
        { label: "Lint", command: "run", arguments: ["npm run lint"] },
      ],
    })
  );
  __setConfig("", "favoritesPanel.configPathForWorkspace", file);

  const result = await importSabitovvtFavorites(store);
  assert.equal(result.added, 1, "the legacy-wrapper item imports");
  const shortcut = findByLabel(store, "Lint");
  assert.equal(shortcut?.action?.kind, "shell", "the wrapped run item becomes a shell pin");
  assert.equal(shortcut?.action?.shellCommand, "npm run lint");
});

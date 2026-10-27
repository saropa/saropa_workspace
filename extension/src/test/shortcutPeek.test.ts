// Tests for peeking a shortcut's file, and the modal that describes a non-file
// shortcut's action before running it.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  Position,
  Location,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoCalls,
  __setInfoAnswer,
  __resetInfo,
  __openedDocuments,
  __resetOpenedDocuments,
  __recordedCommands,
  __resetRecordedCommands,
  __externalOpens,
  __resetEnv,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { peekShortcut, showActionInfo } from "../commands/shortcutPeek";
import type { Shortcut } from "../model/shortcut";

const win = vscode.window as unknown as { activeTextEditor: unknown };
let dir: string;
let store: ShortcutStore;

function action(partial: Record<string, unknown>, extra: Record<string, unknown> = {}): Shortcut {
  return { id: "a1", scope: "global", path: "fallback", order: 0, label: "Act", action: partial, ...extra } as unknown as Shortcut;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-peek-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetOpenedDocuments();
  __resetRecordedCommands();
  __resetEnv();
  const ctx = fakeContext();
  tappedShortcuts.init(ctx as never);
  store = new ShortcutStore(ctx);
  await store.init();
});

afterEach(() => {
  win.activeTextEditor = undefined;
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetOpenedDocuments();
  __resetRecordedCommands();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

async function fileShortcut(name: string): Promise<Shortcut> {
  nodeFs.writeFileSync(`${dir}/${name}`, "x");
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

test("peeking a file with an editor active shows an inline peek at the cursor and leaves focus alone", async () => {
  const file = await fileShortcut("a.txt");
  const docUri = Uri.file(`${dir}/open.ts`);
  const cursor = new Position(7, 2);
  win.activeTextEditor = { document: { uri: docUri }, selection: { active: cursor } };
  await peekShortcut(store, file);
  const [call] = __recordedCommands();
  assert.equal(call.command, "editor.action.peekLocations");
  const [resource, position, locations, mode] = call.args as [Uri, Position, Location[], string];
  assert.equal(resource, docUri);
  assert.equal(position, cursor);
  assert.equal(mode, "peek");
  assert.equal(locations.length, 1);
  assert.equal(locations[0].uri.fsPath, `${dir}/a.txt`);
  assert.deepEqual(locations[0].range, new Position(0, 0));
  assert.deepEqual(__openedDocuments(), []);
  assert.equal(tappedShortcuts.has(file.id), true);
});

test("with no editor to anchor on, the file is opened normally", async () => {
  const file = await fileShortcut("a.txt");
  await peekShortcut(store, file);
  assert.deepEqual(__openedDocuments(), [`${dir}/a.txt`]);
  assert.deepEqual(__recordedCommands(), []);
});

test("an annotation is inert and is not marked tapped", async () => {
  await peekShortcut(store, action({ kind: "separator" }, { id: "sep" }));
  assert.equal(tappedShortcuts.has("sep"), false);
  assert.deepEqual(__infoCalls(), []);
});

test("an unresolvable file warns, and a missing file goes to the recovery prompt", async () => {
  await peekShortcut(store, { id: "x", scope: "project", path: "nowhere.txt", order: 0 } as Shortcut);
  assert.deepEqual(__warningMessages(), ["File not found: nowhere.txt"]);
  const file = await fileShortcut("b.txt");
  nodeFs.rmSync(`${dir}/b.txt`);
  await peekShortcut(store, file);
  assert.equal(__warningMessages().at(-1), "Can't open b.txt — the file no longer exists at b.txt.");
});

test("peeking a non-file shortcut shows its action modal instead", async () => {
  await peekShortcut(store, action({ kind: "url", url: "https://x.test" }));
  assert.equal(__infoCalls().length, 1);
  assert.equal(__infoCalls()[0].message, "Act");
});

test("the modal describes each action kind in one plain line, with Run only for a stored shortcut", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ kind: "url", url: "https://x.test" }, "Opens https://x.test"],
    [{ kind: "shell", shellCommand: "make all" }, "Runs: make all"],
    [{ kind: "command", commandId: "a.b" }, "Runs the a.b command."],
    [{ kind: "macro", steps: [{ kind: "shell", label: "Build" }, { kind: "command" }] }, "Runs these steps: Build -> command"],
    [{ kind: "routine", members: [] }, "fallback"],
  ];
  for (const [act, text] of cases) {
    __resetInfo();
    await showActionInfo(store, action(act));
    const call = __infoCalls()[0];
    assert.deepEqual(call.options, { modal: true, detail: text });
    assert.deepEqual(call.buttons, ["Run now"]);
  }
});

test("missing action fields read as empty text, and a missing steps list as no steps", async () => {
  const out: string[] = [];
  for (const act of [{ kind: "url" }, { kind: "shell" }, { kind: "command" }, { kind: "macro" }]) {
    __resetInfo();
    await showActionInfo(store, action(act));
    out.push((__infoCalls()[0].options as { detail: string }).detail);
  }
  assert.deepEqual(out, ["Opens ", "Runs: ", "Runs the  command.", "Runs these steps: "]);
});

test("a recipe leads with its description, ends with the schedule note and offers Promote", async () => {
  await showActionInfo(store, action({ kind: "shell", shellCommand: "x" }, { isRecipe: true, description: "Does a thing.", schedule: { atTime: "09:00" } }));
  const call = __infoCalls()[0];
  assert.deepEqual(call.options, {
    modal: true,
    detail: "Does a thing.\n\nRuns: x\n\nScheduled for 09:00 (disabled until promoted and enabled).",
  });
  assert.deepEqual(call.buttons, ["Run now", "Promote to Shortcut"]);
});

test("choosing Promote asks the host to promote the recipe", async () => {
  const recipe = action({ kind: "shell", shellCommand: "x" }, { isRecipe: true });
  __setInfoAnswer((_m, items) => items[1]);
  await showActionInfo(store, recipe);
  assert.deepEqual(__recordedCommands(), [{ command: "saropaWorkspace.promoteRecipe", args: [recipe] }]);
});

test("choosing Run runs the action, and dismissing runs nothing", async () => {
  const site = action({ kind: "url", url: "https://x.test/run" });
  await showActionInfo(store, site);
  assert.deepEqual(__externalOpens(), []);
  __setInfoAnswer((_m, items) => items[0]);
  await showActionInfo(store, site);
  assert.deepEqual(__externalOpens(), ["https://x.test/run"]);
});

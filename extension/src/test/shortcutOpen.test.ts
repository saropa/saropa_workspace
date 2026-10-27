// Tests for the single-click open: missing-file recovery, the masked-file gate, preview
// mode, recents and tapped marking, and the line-jump flash.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  Position,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setOpenDialogHandler,
  __resetHandlers,
  __resetWarnings,
  __setWarningAnswer,
  __warningMessages,
  __infoMessages,
  __resetInfo,
  __openedDocuments,
  __shownEditors,
  __resetOpenedDocuments,
  __recordedCommands,
  __resetRecordedCommands,
  __externalOpens,
  __resetEnv,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { tappedShortcuts } from "../model/tappedShortcuts";
import { telemetry } from "../exec/telemetry";
import { openShortcut } from "../commands/shortcutOpen";
import type { Shortcut } from "../model/shortcut";

let dir: string;
let store: ShortcutStore;

async function addFile(name: string, text = "a\nb\nc\nd"): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, name), text);
  await store.addShortcut(Uri.file(`${dir}/${name}`) as never, "project");
  return store.getProjectShortcuts().find((p) => !p.isAuto && p.path === name)!;
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-open-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetOpenedDocuments();
  __resetRecordedCommands();
  __resetEnv();
  const ctx = fakeContext();
  tappedShortcuts.init(ctx as never);
  telemetry.init(ctx);
  store = new ShortcutStore(ctx);
  await store.init();
});

afterEach(() => {
  mock.timers.reset();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetOpenedDocuments();
  __resetRecordedCommands();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("an annotation row opens nothing and is not marked tapped", async () => {
  const note = { id: "note1", scope: "project", path: "", order: 0, action: { kind: "comment" } } as unknown as Shortcut;
  await openShortcut(store, note);
  assert.deepEqual(__openedDocuments(), []);
  assert.equal(tappedShortcuts.has("note1"), false);
});

test("a file shortcut opens as a permanent tab, is marked tapped and is recorded as an open", async () => {
  const file = await addFile("a.txt");
  await openShortcut(store, file);
  assert.deepEqual(__openedDocuments(), [`${dir}/a.txt`]);
  assert.deepEqual(__shownEditors()[0].options, { preview: false });
  assert.equal(tappedShortcuts.has(file.id), true);
  assert.deepEqual(telemetry.recent().map((r) => [r.pinId, r.kind]), [[file.id, "opened"]]);
});

test("preview mode opens the file in a transient tab", async () => {
  const file = await addFile("a.txt");
  __setConfig("saropaWorkspace", "previewMode.enabled", true);
  await openShortcut(store, file);
  assert.deepEqual(__shownEditors()[0].options, { preview: true });
});

test("a shortcut that cannot be resolved warns with its stored path", async () => {
  await openShortcut(store, { id: "x", scope: "project", path: "no/folder.txt", order: 0 } as Shortcut);
  assert.deepEqual(__warningMessages(), ["File not found: no/folder.txt"]);
});

test("a missing file offers relocate, remove and show in folder, and dismissing does nothing", async () => {
  const file = await addFile("gone.txt");
  nodeFs.rmSync(`${dir}/gone.txt`);
  let buttons: string[] = [];
  __setWarningAnswer((_m, items) => {
    buttons = items;
    return undefined;
  });
  await openShortcut(store, file);
  assert.deepEqual(__warningMessages(), ["Can't open gone.txt — the file no longer exists at gone.txt."]);
  assert.deepEqual(buttons, ["Relocate...", "Remove", "Show in Folder"]);
  assert.deepEqual(__openedDocuments(), []);
  assert.equal(store.findShortcut(file.id) !== undefined, true);
});

test("Remove drops the dead shortcut and says so", async () => {
  const file = await addFile("gone.txt");
  nodeFs.rmSync(`${dir}/gone.txt`);
  __setWarningAnswer((_m, items) => items[1]);
  await openShortcut(store, file);
  assert.equal(store.findShortcut(file.id), undefined);
  assert.deepEqual(__infoMessages(), ["Removed gone.txt"]);
});

test("Show in Folder reveals the parent folder of the missing file", async () => {
  const file = await addFile("gone.txt");
  nodeFs.rmSync(`${dir}/gone.txt`);
  __setWarningAnswer((_m, items) => items[2]);
  await openShortcut(store, file);
  const [call] = __recordedCommands();
  assert.equal(call.command, "revealFileInOS");
  assert.equal((call.args[0] as Uri).fsPath, dir);
});

test("Relocate re-points the shortcut to the picked file inside the project", async () => {
  const file = await addFile("gone.txt");
  nodeFs.rmSync(`${dir}/gone.txt`);
  nodeFs.writeFileSync(`${dir}/moved.txt`, "x");
  __setWarningAnswer((_m, items) => items[0]);
  __setOpenDialogHandler(async () => [Uri.file(`${dir}/moved.txt`)]);
  await openShortcut(store, file);
  assert.equal(store.findShortcut(file.id)!.path, "moved.txt");
  assert.deepEqual(__infoMessages(), ["Re-pointed gone.txt to moved.txt."]);
});

test("Relocate to a file outside the project is refused and the path is kept", async () => {
  const file = await addFile("gone.txt");
  nodeFs.rmSync(`${dir}/gone.txt`);
  __setWarningAnswer((m, items) => (m.startsWith("Can't open") ? items[0] : undefined));
  __setOpenDialogHandler(async () => [Uri.file("/elsewhere/else.txt")]);
  await openShortcut(store, file);
  assert.equal(store.findShortcut(file.id)!.path, "gone.txt");
  assert.equal(__warningMessages().at(-1), "A project shortcut must stay inside its workspace folder. Add gone.txt as a global shortcut to point outside it.");
});

test("Relocate with the dialog canceled changes nothing", async () => {
  const file = await addFile("gone.txt");
  nodeFs.rmSync(`${dir}/gone.txt`);
  __setWarningAnswer((_m, items) => items[0]);
  await openShortcut(store, file);
  assert.equal(store.findShortcut(file.id)!.path, "gone.txt");
  assert.deepEqual(__infoMessages(), []);
});

test("a masked file stays closed unless the user chooses Reveal", async () => {
  const file = await addFile("secret.txt");
  const masked = { ...file, masked: true } as Shortcut;
  await openShortcut(store, masked);
  assert.deepEqual(__warningMessages(), ["Reveal secret.txt?"]);
  assert.deepEqual(__openedDocuments(), []);
  __setWarningAnswer((_m, items) => items[0]);
  await openShortcut(store, masked);
  assert.deepEqual(__openedDocuments(), [`${dir}/secret.txt`]);
});

test("a line shortcut moves the cursor to its line and flashes it for a moment", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const file = await addFile("lines.txt", "a\nbb\nccc\ndddd");
  await openShortcut(store, { ...file, line: 3 } as Shortcut);
  const editor = __shownEditors()[0];
  assert.deepEqual(editor.selection.start, new Position(2, 0));
  assert.deepEqual(editor.reveals.map((r) => [r.range.start.line, r.range.end.character, r.type]), [[2, 3, 1]]);
  assert.equal(editor.decorations.length, 1);
  assert.equal(editor.decorations[0].ranges.length, 1);
  mock.timers.tick(1199);
  assert.equal(editor.decorations.length, 1);
  mock.timers.tick(1);
  assert.deepEqual(editor.decorations.map((d) => d.ranges.length), [1, 0]);
});

test("a line past the end lands on the last line and a line below one on the first", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const file = await addFile("lines.txt", "a\nb\nc");
  await openShortcut(store, { ...file, line: 99 } as Shortcut);
  await openShortcut(store, { ...file, line: 0 } as Shortcut);
  const [late, early] = __shownEditors();
  assert.equal(late.selection.start.line, 2);
  assert.equal(early.selection.start.line, 0);
});

test("a tail-follow shortcut ends at the last line and ignores its line number", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const file = await addFile("log.txt", "a\nb\nlast");
  await openShortcut(store, { ...file, tailFollow: true, line: 1 } as Shortcut);
  const editor = __shownEditors()[0];
  assert.deepEqual(editor.reveals.map((r) => [r.range.start.line, r.range.start.character, r.type]), [[2, 4, 0]]);
  assert.equal(editor.decorations.length, 0);
});

test("a url shortcut opens the site on one click", async () => {
  const site = { id: "u1", scope: "global", path: "", order: 0, label: "Site", action: { kind: "url", url: "https://x.test/p" } } as unknown as Shortcut;
  await openShortcut(store, site);
  assert.deepEqual(__externalOpens(), ["https://x.test/p"]);
});

test("a shell shortcut shows what it does instead of running", async () => {
  const shell = { id: "s1", scope: "global", path: "", order: 0, label: "Sh", action: { kind: "shell", shellCommand: "echo hi" } } as unknown as Shortcut;
  await openShortcut(store, shell);
  assert.deepEqual(__infoMessages(), ["Sh"]);
  assert.deepEqual(__externalOpens(), []);
});

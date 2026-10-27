// Tests for the Remote Control entry command: it registers the one declared id and opens the
// panel with the project profile read from the first workspace folder.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders, __registeredCommands, __lastWebviewPanel, __resetWebviewPanels } from "./_stub/vscode";
import { registerRemoteControlCommands } from "../commands/remoteControlCommands";
import { registrarContext, captureRegistrations, declaredCommandIds } from "./registrarCheck";
import { settle } from "./settle";
import type { ShortcutStore } from "../model/shortcutStore";

const ID = "saropaWorkspace.openRemoteControl";
const store = {} as ShortcutStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-rc-")).replace(/\\/g, "/");
  registerRemoteControlCommands(registrarContext(), store);
});

afterEach(() => {
  __resetWebviewPanels();
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("it registers exactly the declared command id", () => {
  const ids = captureRegistrations(() => registerRemoteControlCommands(registrarContext(), store));
  assert.deepEqual(ids, [ID]);
  assert.ok(declaredCommandIds().includes(ID));
});

test("with no folder open it still opens the panel, with no project chip", async () => {
  __setWorkspaceFolders(undefined);
  await __registeredCommands().get(ID)!();
  const panel = __lastWebviewPanel()!;
  assert.equal(panel.viewType, "saropaWorkspace.remoteControl");
  panel.webview.__receiveFromClient({ type: "search", query: "" });
  await settle(() => panel.webview.postedMessages.length === 1);
  const message = panel.webview.postedMessages[0] as { type: string; payload: { project?: unknown } };
  assert.equal(message.type, "catalog");
  assert.equal(message.payload.project, undefined);
});

test("with an Android project open the first paint carries the project chip", async () => {
  nodeFs.mkdirSync(`${tmpDir}/android/app`, { recursive: true });
  nodeFs.writeFileSync(`${tmpDir}/android/app/build.gradle`, 'android {\n  defaultConfig {\n    applicationId "com.example.chip"\n  }\n}\n');
  __setWorkspaceFolders([{ uri: Uri.file(tmpDir), name: "proj", index: 0 }]);
  await __registeredCommands().get(ID)!();
  const panel = __lastWebviewPanel()!;
  panel.webview.__receiveFromClient({ type: "search", query: "" });
  await settle(() => panel.webview.postedMessages.length === 1);
  const message = panel.webview.postedMessages[0] as { payload: { project?: { applicationId?: string; hasAndroidProject: boolean } } };
  assert.equal(message.payload.project?.hasAndroidProject, true);
  assert.equal(message.payload.project?.applicationId, "com.example.chip");
});

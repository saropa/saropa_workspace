// Hand to chat settings: bad values fall back to the defaults.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyHandPrompt, openAgent, readHandSettings } from "../../commands/boardHandToChat";
import * as vscode from "vscode";
import { l10n } from "../../i18n/l10n";
import { stub } from "./hostHelpers";

const SECTION = "saropaWorkspace.releaseBoard.handToChat";

afterEach(() => stub.__resetConfig());

test("defaults: on, standard detail, never offer chats", () => {
  assert.deepEqual(readHandSettings(), { enabled: true, detail: "standard", openChat: "never", agent: "none", customCommand: "", autoOpen: false });
});

test("valid values are read", () => {
  stub.__setConfig(SECTION, "enabled", false);
  stub.__setConfig(SECTION, "detail", "full");
  stub.__setConfig(SECTION, "openChat", "offer");
  stub.__setConfig(SECTION, "agent", "cursor");
  stub.__setConfig(SECTION, "customCommand", "a.b");
  stub.__setConfig(SECTION, "autoOpen", true);
  assert.deepEqual(readHandSettings(), { enabled: false, detail: "full", openChat: "offer", agent: "cursor", customCommand: "a.b", autoOpen: true });
});

test("unknown values fall back", () => {
  stub.__setConfig(SECTION, "detail", "loud");
  stub.__setConfig(SECTION, "openChat", "always");
  stub.__setConfig(SECTION, "agent", "vim");
  const s = readHandSettings();
  assert.equal(s.detail, "standard");
  assert.equal(s.openChat, "never");
  assert.equal(s.agent, "none");
});

// The stub's information-toast hooks.
const info = vscode as unknown as {
  __infoCalls(): ReadonlyArray<{ message: string; buttons: readonly string[] }>;
  __setInfoAnswer(next: (message: string, buttons: readonly string[]) => string | undefined): void;
  __resetInfo(): void;
};

const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

afterEach(() => {
  info.__resetInfo();
  stub.__resetRecordedCommands();
});

test("copy: clipboard gets the full text and the toast names the topic", async () => {
  await copyHandPrompt("FULL PROMPT", undefined, "never", undefined, false, "Blocker: Fix login");
  assert.equal(await vscode.env.clipboard.readText(), "FULL PROMPT");
  const calls = info.__infoCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, l10n("releaseBoard.handToChat.copiedTopic", { topic: "Blocker: Fix login" }));
  assert.deepEqual(calls[0].buttons, []);
});

test("copy: quiet copies without a toast", async () => {
  await copyHandPrompt("Q", undefined, "never", undefined, true, "t");
  assert.equal(info.__infoCalls().length, 0);
});

test("agent set: toast has an Open button; pressing it runs the first known command with no argument", async () => {
  stub.__setConfig(SECTION, "agent", "copilotChat");
  stub.__setKnownCommands(["workbench.panel.chat.view.copilot.focus"]);
  info.__setInfoAnswer((_m, b) => b[0]);
  await copyHandPrompt("P", undefined, "never", undefined, false, "T");
  await settle();
  assert.deepEqual(info.__infoCalls()[0].buttons, ["Open Copilot Chat"]);
  assert.deepEqual(stub.__recordedCommands(), [{ command: "workbench.panel.chat.view.copilot.focus", args: [] }]);
});

test("agent missing: pressing Open shows a plain toast and the prompt stays copied", async () => {
  stub.__setConfig(SECTION, "agent", "cursor");
  info.__setInfoAnswer((_m, b) => b[0]);
  await copyHandPrompt("P2", undefined, "never", undefined, false, "T");
  await settle();
  const calls = info.__infoCalls();
  assert.equal(calls[1].message, l10n("releaseBoard.handToChat.agentMissing", { agent: "Cursor chat" }));
  assert.equal(await vscode.env.clipboard.readText(), "P2");
  assert.deepEqual(stub.__recordedCommands(), []);
});

test("autoOpen: runs the command at once and the toast has no Open button", async () => {
  stub.__setConfig(SECTION, "agent", "custom");
  stub.__setConfig(SECTION, "customCommand", "my.chat");
  stub.__setConfig(SECTION, "autoOpen", true);
  stub.__setKnownCommands(["my.chat"]);
  await copyHandPrompt("P3", undefined, "never", undefined, false, "T");
  assert.deepEqual(stub.__recordedCommands(), [{ command: "my.chat", args: [] }]);
  assert.deepEqual(info.__infoCalls()[0].buttons, []);
});

test("autoOpen with a missing command: one plain not-found toast", async () => {
  stub.__setConfig(SECTION, "agent", "custom");
  stub.__setConfig(SECTION, "customCommand", "nope.cmd");
  stub.__setConfig(SECTION, "autoOpen", true);
  await copyHandPrompt("P4", undefined, "never", undefined, false, "T");
  const calls = info.__infoCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, l10n("releaseBoard.handToChat.agentMissing", { agent: l10n("releaseBoard.handToChat.agentCustom") }));
});

test("openAgent: none and empty custom find nothing", async () => {
  assert.equal(await openAgent("none", ""), false);
  assert.equal(await openAgent("custom", ""), false);
});

test("chat offer still works beside the agent button", async () => {
  stub.__setConfig(SECTION, "agent", "claudeCode");
  await copyHandPrompt("P5", vscode.Uri.file("/tmp/x.md"), "offer", 2, false, "T");
  const c = info.__infoCalls()[0];
  assert.deepEqual(c.buttons, ["Open Claude Code", l10n("releaseBoard.handToChat.openChats")]);
  assert.ok(c.message.includes(l10n("releaseBoard.handToChat.chatsTouched")));
});

// Hand to chat agent mapping: setting value to command ids, pick, and toast text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCommands, agentName, asAgent, pickCommand, toastTopic } from "../../board/handAgent";

test("asAgent: unknown values mean none", () => {
  assert.equal(asAgent("cursor"), "cursor");
  assert.equal(asAgent("claudeCode"), "claudeCode");
  assert.equal(asAgent("emacs"), "none");
  assert.equal(asAgent(undefined), "none");
  assert.equal(asAgent(3), "none");
});

test("agentCommands: none has no commands, built-in agents have a short list", () => {
  assert.deepEqual(agentCommands("none", "x.y"), []);
  for (const a of ["claudeCode", "copilotChat", "cursor"] as const) {
    const ids = agentCommands(a, "");
    assert.ok(ids.length >= 1 && ids.length <= 4, a);
  }
  assert.ok(agentCommands("copilotChat", "").includes("workbench.action.chat.open"));
});

test("agentCommands: custom uses the trimmed command id, empty gives none", () => {
  assert.deepEqual(agentCommands("custom", "  my.chat.open "), ["my.chat.open"]);
  assert.deepEqual(agentCommands("custom", "   "), []);
});

test("agentCommands returns a copy", () => {
  agentCommands("cursor", "").push("x");
  assert.ok(!agentCommands("cursor", "").includes("x"));
});

test("agentName: built-ins named, none and custom empty", () => {
  assert.equal(agentName("copilotChat"), "Copilot Chat");
  assert.equal(agentName("none"), "");
  assert.equal(agentName("custom"), "");
});

test("pickCommand: first known id in order", () => {
  assert.equal(pickCommand(["a", "b", "c"], new Set(["c", "b"])), "b");
  assert.equal(pickCommand(["a"], new Set(["z"])), undefined);
  assert.equal(pickCommand([], new Set(["z"])), undefined);
});

test("toastTopic: folds whitespace and cuts long text", () => {
  assert.equal(toastTopic("Blocker:\n  Fix   it"), "Blocker: Fix it");
  const cut = toastTopic("x".repeat(200), 20);
  assert.equal(cut.length, 20);
  assert.ok(cut.endsWith("…"));
});

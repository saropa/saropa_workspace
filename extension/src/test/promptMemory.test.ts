// Remembered run-token tests (roadmap 4.2 — the promptMemory item 4.1 deferred as
// "host state, inert without activate()"). promptMemory only needs a real
// workspaceState memento, which the fake ExtensionContext supplies, so the
// remember -> getValue -> forget round-trip and the "Run with Last Parameters"
// bypass (resolveRememberedTokens) run without the extension host.
//
// init() is called per test with a FRESH context, so each test starts with empty
// memory; the dialog handlers are reset so an unhandled prompt defaults to a cancel.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setInputHandler,
  __setPickHandler,
  __resetHandlers,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { promptMemory } from "../exec/promptMemory";
import {
  resolveInteractiveTokens,
  resolveRememberedTokens,
} from "../exec/promptTokens";
import { Pin } from "../model/pin";

function pinWith(exec: Pin["exec"]): Pin {
  return { id: "p1", path: "x", scope: "project", order: 0, exec };
}

beforeEach(() => {
  __resetHandlers();
  // Fresh context each test => empty remembered-value memory.
  promptMemory.init(fakeContext());
});

test("remember then getValue round-trips a token value, and has() reports it", async () => {
  assert.equal(promptMemory.has("p1"), false);
  await promptMemory.remember("p1", new Map([["${pick:dev,prod}", "prod"]]));
  assert.equal(promptMemory.getValue("p1", "${pick:dev,prod}"), "prod");
  assert.equal(promptMemory.has("p1"), true);
});

test("remember merges new tokens without erasing existing ones", async () => {
  await promptMemory.remember("p1", new Map([["${prompt:A}", "1"]]));
  await promptMemory.remember("p1", new Map([["${prompt:B}", "2"]]));
  assert.equal(promptMemory.getValue("p1", "${prompt:A}"), "1");
  assert.equal(promptMemory.getValue("p1", "${prompt:B}"), "2");
});

test("forget drops a pin's remembered values", async () => {
  await promptMemory.remember("p1", new Map([["${prompt:A}", "1"]]));
  await promptMemory.forget("p1");
  assert.equal(promptMemory.has("p1"), false);
  assert.equal(promptMemory.getValue("p1", "${prompt:A}"), undefined);
});

test("resolveInteractiveTokens remembers the answer and pre-fills it next run", async () => {
  // First run: the user types a value; it must be remembered.
  __setInputHandler(async () => "server1");
  const pin = pinWith({ command: "deploy ${prompt:Target}" });
  await resolveInteractiveTokens(pin);
  assert.equal(promptMemory.getValue("p1", "${prompt:Target}"), "server1");

  // Second run: the input box should be SEEDED with the remembered value, so the
  // common "same as last time" case is a single Enter.
  let seenValue: string | undefined;
  __setInputHandler(async (opts) => {
    seenValue = opts?.value;
    return "server2";
  });
  await resolveInteractiveTokens(pin);
  assert.equal(seenValue, "server1", "input box should default to the last answer");
});

test("resolveRememberedTokens uses a remembered value without prompting", async () => {
  await promptMemory.remember("p1", new Map([["${pick:dev,prod}", "prod"]]));
  // Any prompt here is a test failure: the bypass must not ask for a known token.
  let asked = 0;
  __setPickHandler(async () => {
    asked++;
    return "dev";
  });
  const result = await resolveRememberedTokens(
    pinWith({ command: "run ${pick:dev,prod}" })
  );
  assert.equal(asked, 0, "a remembered token must not be prompted");
  assert.equal((result as Map<string, string>).get("${pick:dev,prod}"), "prod");
});

test("resolveRememberedTokens asks once for an unremembered token, then remembers it", async () => {
  let asked = 0;
  __setInputHandler(async () => {
    asked++;
    return "v1";
  });
  const pin = pinWith({ command: "deploy ${prompt:Target}" });

  // First bypass with no memory: it must ask once so the run still works.
  const first = await resolveRememberedTokens(pin);
  assert.equal(asked, 1);
  assert.equal((first as Map<string, string>).get("${prompt:Target}"), "v1");

  // Second bypass: the just-entered value is remembered, so no prompt.
  const second = await resolveRememberedTokens(pin);
  assert.equal(asked, 1, "a value entered on the first bypass must be remembered");
  assert.equal((second as Map<string, string>).get("${prompt:Target}"), "v1");
});

test("resolveRememberedTokens aborts (undefined) when a still-needed prompt is canceled", async () => {
  // No memory + a canceled prompt (undefined) must abort the whole run.
  __setInputHandler(async () => undefined);
  const result = await resolveRememberedTokens(
    pinWith({ command: "deploy ${prompt:Target}" })
  );
  assert.equal(result, undefined);
});

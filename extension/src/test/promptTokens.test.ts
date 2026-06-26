// Unit tests for interactive run-token resolution (promptTokens.ts). The pure
// parts (detection + substitution) need nothing; resolveInteractiveTokens drives
// vscode.window dialogs, which the test stub exposes as settable handlers so the
// ask-once and cancel-aborts behavior is testable without the host. promptMemory is
// an inert no-op until activate(), so "last value" defaulting is absent here (it is
// host state, covered by 4.2) — that does not affect the behaviors tested below.
//
// The handler hooks are imported from the stub by relative path so tsc resolves
// them (the bare "vscode" types have no such exports); esbuild aliases "vscode" to
// this same file, so promptTokens.ts and this test share one handler-state module.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __setInputHandler,
  __setPickHandler,
  __resetHandlers,
} from "./_stub/vscode";
import {
  hasInteractiveTokens,
  resolveInteractiveTokens,
  cloneWithResolvedTokens,
} from "../exec/promptTokens";
import { Shortcut } from "../model/shortcut";

// Minimal runnable shortcut with the given exec config.
function shortcutWith(exec: Shortcut["exec"]): Shortcut {
  return { id: "p1", path: "x", scope: "project", order: 0, exec };
}

beforeEach(() => {
  __resetHandlers();
});

test("hasInteractiveTokens detects ${prompt:} / ${pick:} in command, args, or cwd", () => {
  assert.equal(hasInteractiveTokens(shortcutWith({ command: "deploy ${prompt:Target}" })), true);
  assert.equal(hasInteractiveTokens(shortcutWith({ args: ["--env", "${pick:dev,prod}"] })), true);
  assert.equal(hasInteractiveTokens(shortcutWith({ command: "x", cwd: "${prompt:Dir}" })), true);
});

test("hasInteractiveTokens ignores a plain shell ${VAR}", () => {
  // Only prompt/pick are interactive; a literal ${HOME} is left for the shell.
  assert.equal(hasInteractiveTokens(shortcutWith({ command: "echo ${HOME}" })), false);
  assert.equal(hasInteractiveTokens(shortcutWith({})), false);
});

test("cloneWithResolvedTokens substitutes across command, args, and cwd", () => {
  const shortcut = shortcutWith({
    command: "deploy ${prompt:Target}",
    args: ["--env", "${pick:dev,prod}"],
    cwd: "/work/${prompt:Target}",
  });
  const values = new Map([
    ["${prompt:Target}", "server1"],
    ["${pick:dev,prod}", "prod"],
  ]);
  const out = cloneWithResolvedTokens(shortcut, values);
  assert.equal(out.exec?.command, "deploy server1");
  assert.deepEqual(out.exec?.args, ["--env", "prod"]);
  assert.equal(out.exec?.cwd, "/work/server1");
});

test("cloneWithResolvedTokens leaves the stored pin untouched (this-run-only)", () => {
  const shortcut = shortcutWith({ command: "deploy ${prompt:Target}" });
  cloneWithResolvedTokens(shortcut, new Map([["${prompt:Target}", "server1"]]));
  assert.equal(shortcut.exec?.command, "deploy ${prompt:Target}");
});

test("cloneWithResolvedTokens returns a pin with no exec unchanged", () => {
  const shortcut: Shortcut = { id: "p1", path: "x", scope: "project", order: 0 };
  assert.equal(cloneWithResolvedTokens(shortcut, new Map()), shortcut);
});

test("resolveInteractiveTokens asks once per UNIQUE token and returns the map", async () => {
  // The same ${pick:...} reused in command and args must be asked for exactly once.
  let pickCalls = 0;
  __setPickHandler(async () => {
    pickCalls++;
    return "dev";
  });
  const shortcut = shortcutWith({
    command: "run ${pick:dev,prod}",
    args: ["--env", "${pick:dev,prod}"],
  });
  const result = await resolveInteractiveTokens(shortcut);
  assert.equal(pickCalls, 1);
  assert.deepEqual([...(result as Map<string, string>)], [["${pick:dev,prod}", "dev"]]);
});

test("resolveInteractiveTokens resolves a prompt token from the input box", async () => {
  __setInputHandler(async () => "server1");
  const result = await resolveInteractiveTokens(shortcutWith({ command: "deploy ${prompt:Target}" }));
  assert.equal((result as Map<string, string>).get("${prompt:Target}"), "server1");
});

test("resolveInteractiveTokens returns undefined when any prompt is canceled", async () => {
  // A cancel (Escape -> undefined) must abort the whole run with nothing resolved,
  // so the caller leaves no partial run.
  __setInputHandler(async () => undefined);
  const result = await resolveInteractiveTokens(shortcutWith({ command: "deploy ${prompt:Target}" }));
  assert.equal(result, undefined);
});

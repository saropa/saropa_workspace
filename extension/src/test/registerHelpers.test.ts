// Tests for the shortcut command registrar: disposables are tracked and a shortcut-only
// handler runs only when its argument resolves to a shortcut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { __registeredCommands } from "./_stub/vscode";
import { shortcutCommandRegistrar } from "../commands/registerHelpers";
import { registrarContext } from "./registrarCheck";
import type { Shortcut } from "../model/shortcut";

const call = (id: string, ...args: unknown[]): unknown => __registeredCommands().get(id)!(...args);

test("reg registers the handler and keeps its disposable on the context", () => {
  const ctx = registrarContext();
  const { reg } = shortcutCommandRegistrar(ctx);
  reg("test.helpers.reg", (a) => `got ${String(a)}`);
  assert.equal(ctx.subscriptions.length, 1);
  assert.equal(call("test.helpers.reg", 5), "got 5");
  ctx.subscriptions[0].dispose();
  assert.equal(__registeredCommands().has("test.helpers.reg"), false);
});

test("regShortcut runs the body with a shortcut-shaped argument and returns its result", () => {
  const { regShortcut } = shortcutCommandRegistrar(registrarContext());
  const seen: Shortcut[] = [];
  regShortcut("test.helpers.shortcut", (s) => {
    seen.push(s);
    return s.id;
  });
  const shortcut = { id: "s1", scope: "project", path: "a.ts" } as Shortcut;
  assert.equal(call("test.helpers.shortcut", shortcut), "s1");
  assert.deepEqual(seen, [shortcut]);
});

test("regShortcut skips the body and returns undefined for an argument that is not a shortcut", () => {
  const { regShortcut } = shortcutCommandRegistrar(registrarContext());
  let runs = 0;
  regShortcut("test.helpers.skip", () => {
    runs++;
    return "ran";
  });
  for (const arg of [undefined, null, "text", 3, {}, { id: "x" }, { scope: "project" }]) {
    assert.equal(call("test.helpers.skip", arg), undefined);
  }
  assert.equal(runs, 0);
});

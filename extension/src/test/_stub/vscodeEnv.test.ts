// Tests for the stub's clipboard and external-open recorder.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __externalOpens, __resetEnv, env } from "./vscodeEnv";
import { Uri } from "./vscodeTypes";

beforeEach(() => __resetEnv());

test("the clipboard returns the last text written, and starts empty", async () => {
  assert.equal(await env.clipboard.readText(), "");
  await env.clipboard.writeText("first");
  await env.clipboard.writeText("second");
  assert.equal(await env.clipboard.readText(), "second");
});

test("opening a URL is recorded in order and reports success", async () => {
  assert.equal(await env.openExternal(Uri.parse("https://a.test/")), true);
  await env.openExternal(Uri.parse("https://b.test/"));
  assert.deepEqual(__externalOpens(), ["https://a.test/", "https://b.test/"]);
});

test("a reset clears the clipboard and the log", async () => {
  await env.clipboard.writeText("x");
  await env.openExternal(Uri.parse("https://a.test/"));
  __resetEnv();
  assert.equal(await env.clipboard.readText(), "");
  assert.deepEqual(__externalOpens(), []);
});

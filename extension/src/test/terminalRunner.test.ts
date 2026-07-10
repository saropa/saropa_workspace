// Unit tests for the shared output-channel singleton in terminalRunner. Only
// getOutputChannel is host-independent: the stub models window.createOutputChannel
// (a no-op channel carrying its name), so the lazy-create-once contract that every
// run path depends on — scheduled-run log lines and background-run output landing in
// the SAME "Saropa Workspace" panel — is assertable under node --test.
//
// runInTerminal is NOT exercised: it needs window.createTerminal, not modeled by
// the stub. Importing the module is still safe — that API is only touched inside
// the function, never at load time — so the singleton getter bundles and runs alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getOutputChannel } from "../exec/terminalRunner";

test("getOutputChannel returns the shared channel named for the extension", () => {
  const channel = getOutputChannel();
  assert.equal(channel.name, "Saropa Workspace");
});

test("getOutputChannel returns the SAME instance on every call (lazy singleton)", () => {
  // The singleton is the whole point: a second createOutputChannel would split the
  // scheduled-run and background-run output across two panels.
  const first = getOutputChannel();
  const second = getOutputChannel();
  assert.equal(first, second, "the channel is created once and reused");
});

test("the channel exposes the write surface the run paths use without throwing", () => {
  // The run paths only appendLine / show into the channel; the no-op stub must
  // satisfy that surface so a log line never throws into a run.
  const channel = getOutputChannel();
  assert.doesNotThrow(() => {
    channel.appendLine("a scheduled-run log line");
    channel.show(true);
  });
});

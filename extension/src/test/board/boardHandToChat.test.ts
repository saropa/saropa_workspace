// Hand to chat settings: bad values fall back to the defaults.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readHandSettings } from "../../commands/boardHandToChat";
import { stub } from "./hostHelpers";

const SECTION = "saropaWorkspace.releaseBoard.handToChat";

afterEach(() => stub.__resetConfig());

test("defaults: on, standard detail, never offer chats", () => {
  assert.deepEqual(readHandSettings(), { enabled: true, detail: "standard", openChat: "never" });
});

test("valid values are read", () => {
  stub.__setConfig(SECTION, "enabled", false);
  stub.__setConfig(SECTION, "detail", "full");
  stub.__setConfig(SECTION, "openChat", "offer");
  assert.deepEqual(readHandSettings(), { enabled: false, detail: "full", openChat: "offer" });
});

test("unknown values fall back", () => {
  stub.__setConfig(SECTION, "detail", "loud");
  stub.__setConfig(SECTION, "openChat", "always");
  const s = readHandSettings();
  assert.equal(s.detail, "standard");
  assert.equal(s.openChat, "never");
});

// Tests for the launcher webview test fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dataMessage, item, open, openWith, STRINGS } from "./launcherWebviewFixture";

test("item fills every field a card needs and lets the caller override any of them", () => {
  const plain = item({ id: "a", label: "A" });
  assert.deepEqual([plain.pane, plain.groupId, plain.section, plain.runnable, plain.openable], ["mine", "g-daily", "Daily", true, true]);
  const custom = item({ id: "b", label: "B", pane: "files", groupId: "x", openable: false });
  assert.deepEqual([custom.pane, custom.groupId, custom.openable, custom.label], ["files", "x", false, "B"]);
});

test("dataMessage carries the English strings and empty lists unless overridden", () => {
  const msg = dataMessage([item({ id: "a", label: "A" })], { categories: [{ id: "all" }] });
  assert.equal(msg.type, "data");
  assert.equal(msg.strings, STRINGS);
  assert.deepEqual([msg.runHistory, msg.tintHexes, msg.categories], [[], {}, [{ id: "all" }]]);
});

test("open starts the real page and openWith renders the items with the boot messages already taken", () => {
  assert.deepEqual(open().posted, [{ type: "rightPanelVisibility", visible: false }, { type: "ready" }]);
  const page = openWith([item({ id: "a", label: "A" })]);
  assert.deepEqual(page.posted, []);
  assert.deepEqual(page.all(".card-name").map((n) => n.textContent), ["A"]);
});

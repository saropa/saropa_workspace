// Tests for the one runtime value in the Remote Control wire module: the id of the Recent
// pseudo-group. It must stay clear of every real catalog group, or a Recent section and a
// real section would share one collapse state and one DOM id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RECENT_GROUP_ID } from "../views/remoteControl/remoteControlWire";
import { ADB_COMMAND_GROUPS } from "../model/adbCatalogTypes";

test("the Recent group id is 'recent'", () => {
  assert.equal(RECENT_GROUP_ID, "recent");
});

test("the Recent group id differs from every real catalog group", () => {
  assert.ok(!(ADB_COMMAND_GROUPS as readonly string[]).includes(RECENT_GROUP_ID));
});

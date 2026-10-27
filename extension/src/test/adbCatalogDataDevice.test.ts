// Contract tests for the input / power / permissions / deep-link / shell catalog rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADB_CATALOG_DEVICE } from "../model/adbCatalogDataDevice";

const rows = ADB_CATALOG_DEVICE;
const tokensOf = (id: string): string[] =>
  rows.find((e) => e.id === id)!.commandTemplate.match(/\{\w+\}/g) ?? [];

test("the rows and their ids are pinned, in panel order", () => {
  assert.deepEqual(rows.map((e) => e.id), [
    "inputUi.tap",
    "inputUi.swipe",
    "inputUi.text",
    "inputUi.keyevent",
    "inputUi.screencap",
    "inputUi.screenrecord",
    "powerReboot.reboot",
    "powerReboot.reboot-recovery",
    "powerReboot.reboot-bootloader",
    "powerReboot.screen-toggle",
    "permissions.grant",
    "permissions.revoke",
    "permissions.reset",
    "permissions.list",
    "deepLinks.open",
    "deepLinks.open-path",
    "deepLinks.app-links",
    "shell.interactive",
    "shell.run",
    "shell.restart-server",
  ]);
});

test("reboots and the permission reset are destructive; nothing else is", () => {
  assert.deepEqual(rows.filter((e) => e.destructive).map((e) => e.id), [
    "powerReboot.reboot",
    "powerReboot.reboot-recovery",
    "powerReboot.reboot-bootloader",
    "permissions.reset",
  ]);
});

test("restarting the adb server is the only command that works with no device", () => {
  assert.deepEqual(rows.filter((e) => !e.requiresDevice).map((e) => e.id), ["shell.restart-server"]);
});

test("runtime permissions need API 23 and app links need API 31", () => {
  assert.deepEqual(
    rows.filter((e) => e.minSdk !== undefined).map((e) => [e.id, e.minSdk]),
    [
      ["permissions.grant", 23],
      ["permissions.revoke", 23],
      ["permissions.reset", 23],
      ["deepLinks.app-links", 31],
    ]
  );
});

test("each id starts with its own group name", () => {
  for (const e of rows) {
    assert.equal(e.id.split(".")[0], e.group, e.id);
  }
});

test("placeholders match what each command needs", () => {
  assert.deepEqual(tokensOf("inputUi.swipe"), ["{x}", "{y}", "{x2}", "{y2}", "{durationMs}"]);
  assert.deepEqual(tokensOf("permissions.grant"), ["{applicationId}", "{permission}"]);
  assert.deepEqual(tokensOf("deepLinks.open-path"), ["{applicationId}", "{scheme}", "{host}", "{path}"]);
  assert.deepEqual(tokensOf("shell.run"), ["{command}"]);
  assert.deepEqual(tokensOf("powerReboot.reboot"), []);
});

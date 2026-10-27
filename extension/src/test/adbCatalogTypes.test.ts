// Tests for the adb catalog's group list and the entry helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADB_COMMAND_GROUPS,
  adbGroupDescriptionKey,
  adbGroupLabelKey,
  entry,
} from "../model/adbCatalogTypes";

test("the groups keep the order the panel renders them in", () => {
  assert.deepEqual([...ADB_COMMAND_GROUPS], [
    "connection",
    "appControl",
    "files",
    "deviceInfo",
    "inputUi",
    "powerReboot",
    "permissions",
    "deepLinks",
    "shell",
  ]);
});

test("group heading and blurb keys are derived from the group name", () => {
  assert.equal(adbGroupLabelKey("appControl"), "adb.group.appControl.label");
  assert.equal(adbGroupDescriptionKey("deepLinks"), "adb.group.deepLinks.description");
});

test("entry derives both string keys from the id and keeps every other field", () => {
  const e = entry({
    id: "shell.run",
    group: "shell",
    commandTemplate: "adb shell {command}",
    tags: ["run"],
    requiresDevice: true,
    destructive: false,
    minSdk: 21,
  });
  assert.deepEqual(e, {
    id: "shell.run",
    group: "shell",
    commandTemplate: "adb shell {command}",
    tags: ["run"],
    requiresDevice: true,
    destructive: false,
    minSdk: 21,
    labelKey: "adb.shell.run.label",
    descriptionKey: "adb.shell.run.description",
  });
});

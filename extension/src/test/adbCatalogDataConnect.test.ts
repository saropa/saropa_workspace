// Contract tests for the connection / app-control / files / device-info catalog rows.
// The ids are an API (they key pins and run history), so they are pinned here with the
// flags the panel and the execution layer act on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADB_CATALOG_CONNECT } from "../model/adbCatalogDataConnect";

const summary = ADB_CATALOG_CONNECT.map((e) => ({
  id: e.id,
  device: e.requiresDevice,
  destructive: e.destructive,
  minSdk: e.minSdk,
  tokens: e.commandTemplate.match(/\{\w+\}/g) ?? [],
}));

test("the rows and their ids are pinned, in panel order", () => {
  assert.deepEqual(
    summary.map((s) => s.id),
    [
      "connection.list-devices",
      "connection.connect",
      "connection.pair",
      "connection.tcpip",
      "connection.disconnect",
      "connection.reverse",
      "appControl.install",
      "appControl.uninstall",
      "appControl.clear-data",
      "appControl.force-stop",
      "appControl.launch",
      "appControl.list-packages",
      "appControl.package-info",
      "files.push",
      "files.pull",
      "files.delete",
      "deviceInfo.properties",
      "deviceInfo.sdk-level",
      "deviceInfo.battery",
      "deviceInfo.meminfo",
    ]
  );
});

test("only the commands that destroy state are marked destructive", () => {
  assert.deepEqual(
    summary.filter((s) => s.destructive).map((s) => s.id),
    ["appControl.uninstall", "appControl.clear-data", "appControl.force-stop", "files.delete"]
  );
});

test("only the connection commands that work without a device skip the device requirement", () => {
  assert.deepEqual(
    summary.filter((s) => !s.device).map((s) => s.id),
    ["connection.list-devices", "connection.connect", "connection.pair", "connection.disconnect"]
  );
});

test("wireless pairing needs Android 11 and nothing else here has a minimum", () => {
  assert.deepEqual(summary.filter((s) => s.minSdk !== undefined).map((s) => [s.id, s.minSdk]), [["connection.pair", 30]]);
});

test("each id starts with its own group name", () => {
  for (const e of ADB_CATALOG_CONNECT) {
    assert.equal(e.id.split(".")[0], e.group, e.id);
  }
});

test("placeholders match what each command needs", () => {
  const byId = Object.fromEntries(summary.map((s) => [s.id, s.tokens]));
  assert.deepEqual(byId["connection.pair"], ["{host}", "{port}", "{pairingCode}"]);
  assert.deepEqual(byId["files.push"], ["{localPath}", "{remotePath}"]);
  assert.deepEqual(byId["files.pull"], ["{remotePath}", "{localPath}"]);
  assert.deepEqual(byId["appControl.uninstall"], ["{applicationId}"]);
  assert.deepEqual(byId["connection.list-devices"], []);
});

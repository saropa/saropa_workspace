// Unit tests for the adb discovery / connection-health probe (MOBILE_REMOTE_CONTROL_PLAN
// section 5). Only the pure halves are exercised: `adb devices` output in, counted
// summary out. The probe itself shells out and is deliberately untested — CI has no adb
// and no phone — which is exactly why the parsing and the counting were factored out of
// it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adbMissing,
  parseAdbDevices,
  summarizeAdbDevices,
} from "../exec/adbEnvironment";

// --- parseAdbDevices -------------------------------------------------------

test("the header line and daemon chatter never become devices", () => {
  const stdout = [
    "* daemon not running; starting now at tcp:5037",
    "* daemon started successfully",
    "List of devices attached",
    "",
  ].join("\n");
  assert.deepEqual(parseAdbDevices(stdout), []);
});

test("an empty device list parses as zero devices, not as a failure", () => {
  assert.deepEqual(parseAdbDevices("List of devices attached\n\n"), []);
  assert.deepEqual(parseAdbDevices(""), []);
});

test("one attached device parses with its serial and ready state", () => {
  const devices = parseAdbDevices("List of devices attached\nemulator-5554\tdevice\n");
  assert.deepEqual(devices, [{ serial: "emulator-5554", state: "ready" }]);
});

test("unauthorized and offline devices keep their own states", () => {
  const devices = parseAdbDevices(
    ["List of devices attached", "RF8N1\tunauthorized", "192.168.1.9:5555\toffline"].join("\n")
  );
  assert.deepEqual(devices.map((d) => d.state), ["unauthorized", "offline"]);
});

// Everything that is attached but not runnable reads the same way to the panel, so the
// less common states fold into `offline` rather than widening the wire model.
test("bootloader, recovery and authorizing all fold into offline", () => {
  const devices = parseAdbDevices(
    ["a\tbootloader", "b\trecovery", "c\tsideload", "d\tauthorizing"].join("\n")
  );
  assert.deepEqual(devices.map((d) => d.state), ["offline", "offline", "offline", "offline"]);
});

test("a trailing device-detail column does not break the split", () => {
  const devices = parseAdbDevices(
    "List of devices attached\nRF8N1  device product:a51 model:SM_A515F"
  );
  assert.deepEqual(devices, [{ serial: "RF8N1", state: "ready" }]);
});

// --- summarizeAdbDevices ---------------------------------------------------

test("a summary counts each state and names the serial only when there is exactly one", () => {
  const one = summarizeAdbDevices(parseAdbDevices("RF8N1\tdevice"));
  assert.equal(one.total, 1);
  assert.equal(one.ready, 1);
  assert.equal(one.serial, "RF8N1");

  const many = summarizeAdbDevices(
    parseAdbDevices(["a\tdevice", "b\tdevice", "c\tunauthorized", "d\toffline"].join("\n"))
  );
  assert.equal(many.total, 4);
  assert.equal(many.ready, 2);
  assert.equal(many.unauthorized, 1);
  assert.equal(many.offline, 1);
  assert.equal(many.serial, undefined);
});

test("zero devices summarizes to zeroes rather than to undefined", () => {
  const none = summarizeAdbDevices([]);
  assert.deepEqual(none, { total: 0, ready: 0, unauthorized: 0, offline: 0 });
});

// --- adbMissing ------------------------------------------------------------

test("the missing-adb environment reports no devices at all, not zero devices", () => {
  const env = adbMissing();
  assert.equal(env.available, false);
  assert.equal(env.failed, false);
  assert.equal(env.devices, undefined);
});

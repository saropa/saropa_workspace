// Unit tests for the adb discovery / connection-health probe (MOBILE_REMOTE_CONTROL_PLAN
// section 5). Pure halves: `adb devices` output in, counted summary out. The probe itself is
// run against a stand-in adb script on a temporary PATH, so CI needs neither adb nor a phone.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  adbMissing,
  findAdb,
  onAdbEnvironmentProbe,
  parseAdbDevices,
  probeAdbEnvironment,
  summarizeAdbDevices,
  type AdbEnvironment,
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

// --- probeAdbEnvironment ---------------------------------------------------
// PATH is pointed at a temporary folder: empty (adb absent) or holding a stand-in script.

async function withPath(script: string | undefined, body: (bin: string) => Promise<void>): Promise<void> {
  const bin = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "sw-adbprobe-"));
  const original = process.env.PATH;
  process.env.PATH = bin;
  try {
    if (script !== undefined) {
      const file = nodePath.join(bin, "adb");
      nodeFs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
      nodeFs.chmodSync(file, 0o755);
    }
    await body(bin);
  } finally {
    process.env.PATH = original;
    nodeFs.rmSync(bin, { recursive: true, force: true });
  }
}
const posix = { skip: process.platform === "win32" };

test("with no adb on PATH the probe reports it missing", async () => {
  await withPath(undefined, async () => {
    assert.equal(findAdb(), undefined);
    assert.deepEqual(await probeAdbEnvironment(), adbMissing());
  });
});

test("with adb on PATH the probe counts the attached devices", posix, async () => {
  await withPath('printf "List of devices attached\\nemulator-5554\\tdevice\\nRF8N1\\tunauthorized\\n"', async (bin) => {
    assert.equal(findAdb(), nodePath.join(bin, "adb"));
    assert.deepEqual(await probeAdbEnvironment(), {
      available: true,
      path: nodePath.join(bin, "adb"),
      devices: { total: 2, ready: 1, unauthorized: 1, offline: 0 },
      failed: false,
    });
  });
});

test("an adb that exits with an error is reported as failed, not as missing", posix, async () => {
  await withPath("exit 1", async (bin) => {
    assert.deepEqual(await probeAdbEnvironment(), { available: true, path: nodePath.join(bin, "adb"), failed: true });
  });
});

test("every probe result reaches the listeners until they are disposed", async () => {
  const seen: AdbEnvironment[] = [];
  const handle = onAdbEnvironmentProbe((env) => seen.push(env));
  await withPath(undefined, async () => {
    await probeAdbEnvironment();
    handle.dispose();
    await probeAdbEnvironment();
  });
  assert.deepEqual(seen, [adbMissing()]);
});

test("a listener that throws does not spoil the probe result", async () => {
  const quiet = console.error;
  console.error = (): void => {};
  const handle = onAdbEnvironmentProbe(() => {
    throw new Error("listener failure");
  });
  try {
    await withPath(undefined, async () => {
      assert.deepEqual(await probeAdbEnvironment(), adbMissing());
    });
  } finally {
    handle.dispose();
    console.error = quiet;
  }
});

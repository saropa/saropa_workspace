// Unit tests for the project-shape and device context keys that gate sidebar sections.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  HAS_ANDROID_KEY,
  HAS_FLUTTER_KEY,
  HAS_DEVICE_KEY,
  publishProjectContext,
  publishDeviceContext,
  wireSectionContext,
  onSectionProfileChange,
} from "../activation/sectionContext";
import { emptyAndroidProjectProfile } from "../model/androidProjectProfile";
import type { AdbEnvironment } from "../exec/adbEnvironment";

type StubVscode = typeof vscode & {
  __recordedCommands(): ReadonlyArray<{ command: string; args: unknown[] }>;
  __resetRecordedCommands(): void;
  __setWorkspaceFolders(f: undefined): void;
};
const stub = vscode as StubVscode;

// The last value set for each context key, in call order.
function contextValues(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of stub.__recordedCommands()) {
    if (c.command === "setContext") {
      out[String(c.args[0])] = c.args[1];
    }
  }
  return out;
}

beforeEach(() => {
  stub.__resetRecordedCommands();
  stub.__setWorkspaceFolders(undefined);
});

test("context keys are namespaced under saropaWorkspace", () => {
  for (const k of [HAS_ANDROID_KEY, HAS_FLUTTER_KEY, HAS_DEVICE_KEY]) {
    assert.ok(k.startsWith("saropaWorkspace.has"));
  }
});

test("an unresolved profile reads as neither Android nor Flutter", () => {
  publishProjectContext(undefined);
  assert.deepEqual(contextValues(), { [HAS_ANDROID_KEY]: false, [HAS_FLUTTER_KEY]: false });
});

test("a resolved profile publishes both flags independently", () => {
  publishProjectContext({ ...emptyAndroidProjectProfile(), hasAndroidProject: true });
  assert.deepEqual(contextValues(), { [HAS_ANDROID_KEY]: true, [HAS_FLUTTER_KEY]: false });
  stub.__resetRecordedCommands();
  publishProjectContext({ ...emptyAndroidProjectProfile(), isFlutterProject: true });
  assert.deepEqual(contextValues(), { [HAS_ANDROID_KEY]: false, [HAS_FLUTTER_KEY]: true });
});

test("a device counts only when at least one is ready", () => {
  const env = (ready: number | undefined): AdbEnvironment =>
    ({
      available: true,
      failed: false,
      devices: ready === undefined ? undefined : { ready },
    }) as unknown as AdbEnvironment;
  publishDeviceContext(env(1));
  assert.equal(contextValues()[HAS_DEVICE_KEY], true);
  publishDeviceContext(env(0));
  assert.equal(contextValues()[HAS_DEVICE_KEY], false);
  publishDeviceContext(env(undefined));
  assert.equal(contextValues()[HAS_DEVICE_KEY], false);
  publishDeviceContext({ available: false, failed: false });
  assert.equal(contextValues()[HAS_DEVICE_KEY], false);
});

test("wiring with no workspace folder publishes safe defaults and registers disposables", () => {
  const subscriptions: Array<{ dispose(): void }> = [];
  wireSectionContext({ subscriptions } as unknown as vscode.ExtensionContext);
  assert.deepEqual(contextValues(), {
    [HAS_ANDROID_KEY]: false,
    [HAS_FLUTTER_KEY]: false,
    [HAS_DEVICE_KEY]: false,
  });
  // The profile emitter and the adb probe subscription.
  assert.equal(subscriptions.length, 2);
  for (const s of subscriptions) {
    s.dispose();
  }
});

test("onSectionProfileChange is a subscribable event", () => {
  const sub = onSectionProfileChange(() => {});
  assert.equal(typeof sub.dispose, "function");
  sub.dispose();
});

// Unit tests for the launcher's Mobile Remote Control message routing (handleAdbItem in
// launcherViewMessages.ts). Mirrors launcherDrop.test.ts's stubbing approach: drive
// handleLauncherMessage with a real message payload against a fake store/context and
// assert on the OBSERVABLE side effects the real runAdbCommand/pinAdbCommand produce
// (a store mutation, a recorded toast, a repaint call) rather than mocking those
// functions out — they are plain imports, not something the context injects, so there is
// nothing to substitute them with short of module mocking, which nothing else in this
// suite does.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __errorMessages,
  __resetErrorMessages,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { handleLauncherMessage, LauncherMessageContext } from "../views/launcherViewMessages";
import { ADB_COMMAND_CATALOG } from "../model/adbCommandCatalog";
import { l10n } from "../i18n/l10n";
import { Shortcut } from "../model/shortcut";

// A non-destructive, non-interactive, device-optional catalog entry: no confirm-dialog
// wording or run-parameter prompt complicates what is under test here, which is ROUTING,
// not the confirm/prompt machinery itself (that is remoteControlActions.test.ts's job).
const SAFE_ENTRY_ID = "connection.list-devices";

let postCount = 0;
let addedShellShortcuts: { label: string; command: string }[] = [];
let findShortcutCalled = false;

function context(): LauncherMessageContext {
  const store = {
    // handleShortcutAction is the ONLY branch that resolves an id through findShortcut;
    // an "adb:" id must never reach it, so a call here is itself a routing bug.
    findShortcut: (_id: string): Shortcut | undefined => {
      findShortcutCalled = true;
      return undefined;
    },
    addShellShortcut: async (
      label: string,
      shellCommand: string,
      _scope: unknown,
      _useIntegratedTerminal: boolean
    ): Promise<boolean> => {
      addedShellShortcuts.push({ label, command: shellCommand });
      return true;
    },
  };
  return {
    store,
    projectFiles: {},
    watchStore: {},
    noteStore: {},
    scriptsProvider: {},
    extensionPath: "/ext",
    globalState: fakeContext().globalState,
    androidProfile: undefined,
    post: async (): Promise<void> => {
      postCount++;
    },
  } as unknown as LauncherMessageContext;
}

beforeEach(() => {
  __resetErrorMessages();
  postCount = 0;
  addedShellShortcuts = [];
  findShortcutCalled = false;
});

test("a run message on an adb id routes to runAdbCommand, not handleShortcutAction", async () => {
  await handleLauncherMessage({ type: "run", id: `adb:${SAFE_ENTRY_ID}` }, context());
  // The test vscode stub's showInformationMessage/showWarningMessage always resolve
  // undefined, so confirmRun's dry-run dialog is always declined here — runAdbCommand
  // therefore returns undefined (the "canceled" path) and, per the repaint-on-cancel fix,
  // ctx.post() must NOT have been called. What this test actually asserts is routing: the
  // real runAdbCommand ran (nothing threw resolving/substituting the entry) and
  // handleShortcutAction's store lookup was never reached for an "adb:" id.
  assert.equal(findShortcutCalled, false);
  assert.equal(postCount, 0);
});

test("a run message on an unresolvable adb id toasts not-found instead of silently no-op'ing", async () => {
  await handleLauncherMessage({ type: "run", id: "adb:does-not-exist" }, context());
  assert.equal(findShortcutCalled, false);
  assert.equal(postCount, 0);
  assert.deepEqual(__errorMessages(), [l10n("remoteControl.run.notFound")]);
});

test("a pin message on an adb id routes to pinAdbCommand, not handleShortcutAction", async () => {
  const entry = ADB_COMMAND_CATALOG[0];
  await handleLauncherMessage({ type: "pin", id: `adb:${entry.id}` }, context());
  assert.equal(findShortcutCalled, false);
  assert.equal(addedShellShortcuts.length, 1);
  assert.equal(addedShellShortcuts[0].label, l10n(entry.labelKey));
});

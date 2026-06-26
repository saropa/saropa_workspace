// Branch-aware shortcut sets (roadmap 3.2). Two things are under test here:
//   - ShortcutStore.getSetShortcuts: reading a named set's stored pins WITHOUT switching to
//     it (the active set's pins are at the file top level; an inactive set's pins
//     live in `sets`), backed by the same fs-backed store shim the shortcutStore tests
//     use — so this runs the real read path, not a reimplementation.
//   - BranchSetBinder: the switch-on-branch logic. A hand-rolled fake BranchTracker
//     stands in for the real .git/HEAD watcher (which needs createFileSystemWatcher,
//     a host API), so the binder's decision logic is exercised in isolation: gated
//     by the enabled flag, keyed by branch binding, a no-op when already on the set,
//     the on-switch shortcut run, and the change-guard that must not undo a manual switch.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  EventEmitter,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __recordedCommands,
  __resetRecordedCommands,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { BranchSetBinder } from "../exec/branchSets";
import type { BranchTracker } from "../exec/gitBranch";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

// A stand-in for BranchTracker exposing only what the binder reads: the change
// event and the primary branch. setBranchSilently changes the reported branch
// WITHOUT firing (for deterministic, awaitable applyNow tests); checkout changes it
// AND fires (to exercise the event-driven path and its change-guard).
class FakeTracker {
  private readonly emitter = new EventEmitter<void>();
  readonly onDidChangeBranch = this.emitter.event;
  private current: string | undefined;

  primaryBranch(): string | undefined {
    return this.current;
  }
  setBranchSilently(branch: string | undefined): void {
    this.current = branch;
  }
  checkout(branch: string | undefined): void {
    this.current = branch;
    this.emitter.fire();
  }
}

const asTracker = (t: FakeTracker): BranchTracker => t as unknown as BranchTracker;

// Let the binder's fire-and-forget onBranchSignal (started by the event path, not
// awaitable from the caller) settle. The store's fs shim is node-backed, so a few
// macrotask turns are enough for switchSet's read/write to complete.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __resetRecordedCommands();
  // Skip recipe detection so a refresh exercises only store IO (mirrors shortcutStore.test).
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-branchset-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetRecordedCommands();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// A store with two sets: Default (active, holds default.ts) and Release (inactive,
// holds release.ts). Returns the store plus the release shortcut's id for on-switch tests.
async function storeWithTwoSets(): Promise<{ store: ShortcutStore; releaseShortcutId: string }> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "default.ts")), "project");
  // createSet switches to the new (empty) set; add the Release-only shortcut there.
  await store.createSet("Release");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "release.ts")), "project");
  const releaseShortcutId = store
    .getProjectShortcuts()
    .find((p) => p.path === "release.ts")!.id;
  // Switch back so Default is the active set at the start of each test.
  await store.switchSet("Default");
  return { store, releaseShortcutId };
}

test("getSetPins returns the active set's pins, an inactive set's pins, and [] for an unknown set", async () => {
  const { store } = await storeWithTwoSets();
  assert.equal(store.getActiveSetName(), "Default");

  const defaultShortcuts = await store.getSetShortcuts("Default");
  assert.ok(
    defaultShortcuts.some((p) => p.path === "default.ts"),
    "the active set's pins should be read from the file top level"
  );
  assert.ok(
    !defaultShortcuts.some((p) => p.path === "release.ts"),
    "the active set must not leak another set's pins"
  );

  const releaseShortcuts = await store.getSetShortcuts("Release");
  assert.ok(
    releaseShortcuts.some((p) => p.path === "release.ts"),
    "an inactive set's pins should be read from `sets` without switching"
  );

  assert.deepEqual(await store.getSetShortcuts("Nope"), [], "unknown set -> []");
});

test("when enabled, applyNow switches the active set to the current branch's bound set", async () => {
  const { store } = await storeWithTwoSets();
  const ctx = fakeContext();
  await ctx.workspaceState.update("saropaWorkspace.branchSets", {
    feature: { set: "Release" },
  });
  __setConfig("saropaWorkspace", "branchAware.enabled", true);

  const tracker = new FakeTracker();
  tracker.setBranchSilently("feature");
  const binder = new BranchSetBinder(ctx, store, asTracker(tracker));

  await binder.applyNow();
  assert.equal(
    store.getActiveSetName(),
    "Release",
    "the bound set should become active on the feature branch"
  );
  binder.dispose();
});

test("when disabled, applyNow does not switch even with a matching binding", async () => {
  const { store } = await storeWithTwoSets();
  const ctx = fakeContext();
  await ctx.workspaceState.update("saropaWorkspace.branchSets", {
    feature: { set: "Release" },
  });
  // branchAware.enabled left at its false default.

  const tracker = new FakeTracker();
  tracker.setBranchSilently("feature");
  const binder = new BranchSetBinder(ctx, store, asTracker(tracker));

  await binder.applyNow();
  assert.equal(
    store.getActiveSetName(),
    "Default",
    "a disabled binder must leave the active set untouched"
  );
  binder.dispose();
});

test("a branch with no binding leaves the active set unchanged", async () => {
  const { store } = await storeWithTwoSets();
  const ctx = fakeContext();
  __setConfig("saropaWorkspace", "branchAware.enabled", true);

  const tracker = new FakeTracker();
  tracker.setBranchSilently("untracked-branch");
  const binder = new BranchSetBinder(ctx, store, asTracker(tracker));

  await binder.applyNow();
  assert.equal(store.getActiveSetName(), "Default");
  binder.dispose();
});

test("outside a git repo (no branch) the binder is inert", async () => {
  const { store } = await storeWithTwoSets();
  const ctx = fakeContext();
  await ctx.workspaceState.update("saropaWorkspace.branchSets", {
    feature: { set: "Release" },
  });
  __setConfig("saropaWorkspace", "branchAware.enabled", true);

  const tracker = new FakeTracker();
  tracker.setBranchSilently(undefined); // no readable branch
  const binder = new BranchSetBinder(ctx, store, asTracker(tracker));

  await binder.applyNow();
  assert.equal(store.getActiveSetName(), "Default");
  binder.dispose();
});

test("an on-switch pin runs through saropaWorkspace.runPin after the switch", async () => {
  const { store, releaseShortcutId } = await storeWithTwoSets();
  const ctx = fakeContext();
  await ctx.workspaceState.update("saropaWorkspace.branchSets", {
    feature: { set: "Release", runPinId: releaseShortcutId },
  });
  __setConfig("saropaWorkspace", "branchAware.enabled", true);

  const tracker = new FakeTracker();
  tracker.setBranchSilently("feature");
  const binder = new BranchSetBinder(ctx, store, asTracker(tracker));

  await binder.applyNow();
  assert.equal(store.getActiveSetName(), "Release");
  const ran = __recordedCommands().filter(
    (c) => c.command === "saropaWorkspace.runPin"
  );
  assert.equal(ran.length, 1, "the on-switch pin should be run exactly once");
  binder.dispose();
});

test("the change-guard does not undo a manual switch on the same branch", async () => {
  const { store } = await storeWithTwoSets();
  const ctx = fakeContext();
  await ctx.workspaceState.update("saropaWorkspace.branchSets", {
    feature: { set: "Release" },
  });
  __setConfig("saropaWorkspace", "branchAware.enabled", true);

  const tracker = new FakeTracker();
  const binder = new BranchSetBinder(ctx, store, asTracker(tracker));

  // Check out the feature branch: the bound set activates.
  tracker.checkout("feature");
  await flush();
  assert.equal(store.getActiveSetName(), "Release");

  // The user manually switches away while STAYING on the feature branch.
  await store.switchSet("Default");
  assert.equal(store.getActiveSetName(), "Default");

  // A further tracker fire for the SAME branch (e.g. a workspace-folder change)
  // must not re-apply the binding and clobber the manual choice.
  tracker.checkout("feature");
  await flush();
  assert.equal(
    store.getActiveSetName(),
    "Default",
    "an unrelated fire on the same branch must not revert a manual switch"
  );
  binder.dispose();
});

// Tests for linking and unlinking the current git branch to a shortcut set.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __getConfig,
  __resetConfig,
  __registeredCommands,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __setInfoAnswer,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { ShortcutStore } from "../model/shortcutStore";
import { registerBranchSetCommands } from "../commands/branchSetCommands";
import { drivePicks } from "./uiDrivers";
import type { BranchSetBinder, BranchSetBinding } from "../exec/branchSets";

const LINK = "saropaWorkspace.linkBranchToSet";
const UNLINK = "saropaWorkspace.unlinkBranch";

let dir: string;
let store: ShortcutStore;
let ctx: ReturnType<typeof registrarContext>;
let branch: string | undefined;
let bindings: Record<string, BranchSetBinding>;
let enabled: boolean;

// A binder over plain state: the commands only call these five methods.
function fakeBinder(): BranchSetBinder {
  return {
    currentBranch: () => branch,
    getBinding: (b: string) => bindings[b],
    setBinding: async (b: string, value: BranchSetBinding) => {
      bindings = { ...bindings, [b]: value };
    },
    clearBinding: async (b: string) => {
      const next = { ...bindings };
      delete next[b];
      bindings = next;
    },
    isEnabled: () => enabled,
  } as unknown as BranchSetBinder;
}

const run = (id: string): Promise<unknown> => Promise.resolve(__registeredCommands().get(id)!());

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bset-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  branch = "feature/x";
  bindings = {};
  enabled = true;
  store = new ShortcutStore(fakeContext());
  await store.init();
  ctx = registrarContext();
  registerBranchSetCommands(ctx as never, store, fakeBinder());
});

afterEach(() => {
  ctx.subscriptions.forEach((d) => d.dispose());
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("registers the link and unlink commands, each kept for disposal", () => {
  const again = registrarContext();
  const ids = captureRegistrations(() => registerBranchSetCommands(again as never, store, fakeBinder()));
  assert.deepEqual(ids, [LINK, UNLINK]);
  assert.equal(again.subscriptions.length, 2);
  again.subscriptions.forEach((d) => d.dispose());
});

test("linking needs a folder and a branch", async () => {
  __setWorkspaceFolders(undefined);
  await run(LINK);
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  branch = undefined;
  await run(LINK);
  assert.deepEqual(__warningMessages(), [
    "Open a workspace folder to use shortcut sets.",
    "No git branch to link: open a repository on a branch (a detached or unreadable HEAD has no branch to bind).",
  ]);
  assert.deepEqual(bindings, {});
});

test("the set picker names the branch and tags the active and the already linked set", async () => {
  await store.createSet("Beta");
  await store.switchSet("Beta");
  bindings = { "feature/x": { set: "Default" } };
  const shown = drivePicks(undefined);
  await run(LINK);
  assert.equal(shown[0].options.placeHolder, "Pick the shortcut set to activate on branch feature/x.");
  assert.deepEqual(shown[0].rows.map((r) => [r.label, r.description]), [
    ["Beta", "active"],
    ["Default", "linked now"],
  ]);
});

test("a set that is both active and linked carries both tags", async () => {
  bindings = { "feature/x": { set: "Default" } };
  const shown = drivePicks(undefined);
  await run(LINK);
  assert.equal(shown[0].rows[0].description, "active · linked now");
});

test("canceling either step stores nothing", async () => {
  drivePicks(undefined);
  await run(LINK);
  drivePicks("Default", undefined);
  await run(LINK);
  assert.deepEqual(bindings, {});
});

test("choosing None stores just the set and confirms when switching is on", async () => {
  const shown = drivePicks("Default", "$(circle-slash) No shortcut — just switch the set");
  await run(LINK);
  assert.deepEqual(bindings, { "feature/x": { set: "Default" } });
  assert.deepEqual(__infoMessages(), ["Branch feature/x now activates shortcut set Default on checkout."]);
  assert.equal(shown[1].options.placeHolder, "Optionally run a shortcut when switching to Default, or pick None.");
});

test("the run-on-switch list holds stored shortcuts and global ones but no comments or separators", async () => {
  nodeFs.writeFileSync(`${dir}/build.sh`, "x");
  await store.addShortcut(Uri.file(`${dir}/build.sh`) as never, "project");
  await store.addAnnotationShortcut("comment", "project", "A remark");
  await store.addAnnotationShortcut("separator", "project", "Divider");
  assert.deepEqual(store.getProjectShortcuts().filter((p) => p.action).map((p) => p.action?.kind), ["comment", "separator"]);
  const shown = drivePicks("Default", undefined);
  await run(LINK);
  const labels = shown[1].rows.map((r) => r.label);
  assert.equal(labels[0], "$(circle-slash) No shortcut — just switch the set");
  assert.ok(labels.includes("build.sh"));
  assert.ok(!labels.includes("A remark") && !labels.includes("Divider"));
  const row = shown[1].rows.find((r) => r.label === "build.sh")!;
  assert.equal(row.description, "build.sh");
});

test("picking a shortcut stores its id with the set", async () => {
  nodeFs.writeFileSync(`${dir}/build.sh`, "x");
  await store.addShortcut(Uri.file(`${dir}/build.sh`) as never, "project");
  const id = store.getProjectShortcuts().find((p) => p.path === "build.sh")!.id;
  drivePicks("Default", "build.sh");
  await run(LINK);
  assert.deepEqual(bindings, { "feature/x": { set: "Default", runPinId: id } });
});

test("with switching off, linking offers to turn it on and does so when accepted", async () => {
  enabled = false;
  drivePicks("Default", "$(circle-slash) No shortcut — just switch the set");
  await run(LINK);
  assert.deepEqual(__infoMessages(), ["Linked branch feature/x to shortcut set Default. Turn on branch-aware switching to apply it."]);
  assert.equal(__getConfig("saropaWorkspace", "branchAware.enabled"), undefined);

  __resetInfo();
  __setInfoAnswer((_m, items) => items[0]);
  drivePicks("Default", "$(circle-slash) No shortcut — just switch the set");
  await run(LINK);
  assert.equal(__getConfig("saropaWorkspace", "branchAware.enabled"), true);
});

test("unlinking needs a branch, says when nothing is linked, and otherwise removes the link", async () => {
  branch = undefined;
  await run(UNLINK);
  assert.deepEqual(__warningMessages(), ["No git branch to link: open a repository on a branch (a detached or unreadable HEAD has no branch to bind)."]);
  branch = "feature/x";
  await run(UNLINK);
  assert.deepEqual(__infoMessages(), ["Branch feature/x is not linked to a shortcut set."]);
  bindings = { "feature/x": { set: "Beta" }, other: { set: "Gamma" } };
  __resetInfo();
  await run(UNLINK);
  assert.deepEqual(bindings, { other: { set: "Gamma" } });
  assert.deepEqual(__infoMessages(), ["Unlinked branch feature/x from shortcut set Beta."]);
});

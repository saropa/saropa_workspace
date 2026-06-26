// Time-bomb / ephemeral pins (WOW #9) — the user-facing expiry setup. Three exported
// handlers are under test against a real ShortcutStore so the persisted Shortcut.expires shape
// is observable:
//   - shortcutUntil: a wall-clock preset picker (plus the custom date/time prompt) that
//     sets expires.at without dropping an existing branch condition.
//   - shortcutUntilBranchChange: bombs the shortcut on the current git branch, read from a
//     .git/HEAD the test writes into the temp folder; warns (no write) when no branch
//     is readable, and preserves an existing wall-clock condition.
//   - clearShortcutExpiry: defuses the bomb (and is a no-op-with-feedback when nothing was
//     set).
//
// The auto-shortcut guard is covered too: an auto-shortcut is recomputed each refresh, so the
// handler must warn and persist nothing.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setPickHandler,
  __setInputHandler,
  __resetHandlers,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import {
  shortcutUntil,
  shortcutUntilBranchChange,
  clearShortcutExpiry,
} from "../commands/configureExpiry";
import type { Shortcut } from "../model/shortcut";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __resetHandlers();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-expiry-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetHandlers();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// One explicit project shortcut; the file is written so the shortcut resolves to a real URI.
async function storeWithShortcut(): Promise<{ store: ShortcutStore; shortcut: Shortcut }> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  nodeFs.writeFileSync(nodePath.join(tmpDir, "a.ts"), "");
  await store.addShortcut(asUri(Uri.joinPath(folder.uri, "a.ts")), "project");
  const shortcut = store.getProjectShortcuts().find((p) => !p.isAuto)!;
  return { store, shortcut };
}

// Re-read a shortcut from the store by id, so an assertion sees the persisted shape, not
// the stale pre-mutation object.
function reread(store: ShortcutStore, id: string): Shortcut {
  const shortcut = store.findShortcut(id);
  assert.ok(shortcut, "the pin should still exist after the mutation");
  return shortcut;
}

test("pinUntil sets a wall-clock instant from the chosen preset", async () => {
  const { store, shortcut } = await storeWithShortcut();
  // Pick the "in 1 hour" preset: it is the first row and carries a concrete `at`.
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ at?: number; custom?: boolean }>;
    return list.find((i) => i.at !== undefined) as never;
  });
  const before = Date.now();
  await shortcutUntil(store, shortcut);
  const at = reread(store, shortcut.id).expires?.at;
  assert.ok(typeof at === "number" && at > before, "an expiry instant is stored");
});

test("pinUntil custom row prompts for a date/time and stores the parsed instant", async () => {
  const { store, shortcut } = await storeWithShortcut();
  // Pick the custom row, then type a date; the editor parses it as a local instant.
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ custom?: boolean }>;
    return list.find((i) => i.custom === true) as never;
  });
  __setInputHandler(async () => "2099-12-31 18:30");
  await shortcutUntil(store, shortcut);
  const at = reread(store, shortcut.id).expires?.at;
  // 2099-12-31 18:30 local — assert the calendar fields round-trip rather than a raw
  // epoch (which depends on the runner's timezone).
  assert.ok(typeof at === "number");
  const d = new Date(at!);
  assert.equal(d.getFullYear(), 2099);
  assert.equal(d.getMonth(), 11);
  assert.equal(d.getDate(), 31);
  assert.equal(d.getHours(), 18);
  assert.equal(d.getMinutes(), 30);
});

test("pinUntil aborts and writes nothing when the preset picker is dismissed", async () => {
  const { store, shortcut } = await storeWithShortcut();
  // Default handler returns undefined (Esc); no expiry must be written.
  await shortcutUntil(store, shortcut);
  assert.equal(reread(store, shortcut.id).expires, undefined);
});

test("pinUntilBranchChange bombs the pin on the current git branch", async () => {
  const { store, shortcut } = await storeWithShortcut();
  // A minimal .git/HEAD so readCurrentBranch resolves a branch name.
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".git"), { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(tmpDir, ".git", "HEAD"),
    "ref: refs/heads/feature-x\n"
  );
  await shortcutUntilBranchChange(store, shortcut);
  assert.equal(reread(store, shortcut.id).expires?.onBranchAway, "feature-x");
});

test("pinUntilBranchChange warns and writes nothing when no branch is readable", async () => {
  const { store, shortcut } = await storeWithShortcut();
  // No .git present, so readCurrentBranch returns undefined; the handler must warn
  // (a no-op via the stub) and leave the shortcut un-bombed rather than store a condition
  // that can never be evaluated.
  await shortcutUntilBranchChange(store, shortcut);
  assert.equal(reread(store, shortcut.id).expires, undefined);
});

test("pinUntilBranchChange preserves an existing wall-clock condition", async () => {
  const { store, shortcut } = await storeWithShortcut();
  await store.setShortcutExpiry(shortcut, { at: 9_999_999_999_000 });
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".git"), { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(tmpDir, ".git", "HEAD"),
    "ref: refs/heads/main\n"
  );
  await shortcutUntilBranchChange(store, reread(store, shortcut.id));
  const expires = reread(store, shortcut.id).expires;
  assert.equal(expires?.onBranchAway, "main", "the branch condition is added");
  assert.equal(expires?.at, 9_999_999_999_000, "the wall-clock condition survives");
});

test("clearPinExpiry defuses a set bomb", async () => {
  const { store, shortcut } = await storeWithShortcut();
  await store.setShortcutExpiry(shortcut, { at: 9_999_999_999_000 });
  await clearShortcutExpiry(store, reread(store, shortcut.id));
  assert.equal(reread(store, shortcut.id).expires, undefined);
});

test("clearPinExpiry is a no-op when nothing was set", async () => {
  const { store, shortcut } = await storeWithShortcut();
  await clearShortcutExpiry(store, shortcut);
  assert.equal(reread(store, shortcut.id).expires, undefined);
});

test("pinUntil refuses an auto-pin (recomputed, nowhere to persist)", async () => {
  const { store } = await storeWithShortcut();
  // The seeded saropa-workspace.json record is an auto-shortcut; the handler must warn and
  // write nothing to it.
  const autoShortcut = store.getProjectShortcuts().find((p) => p.isAuto)!;
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ at?: number }>;
    return list.find((i) => i.at !== undefined) as never;
  });
  await shortcutUntil(store, autoShortcut);
  // An auto-shortcut is not in pins[], so a mutation no-ops; re-resolving by id yields the
  // same recomputed shortcut with no stored expiry.
  const found = store.getProjectShortcuts().find((p) => p.id === autoShortcut.id);
  assert.equal(found?.expires, undefined);
});

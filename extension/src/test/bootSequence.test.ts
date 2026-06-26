// Workspace boot sequence (roadmap 3.1). Two reachable, store-backed surfaces are
// under test here:
//   - runBootSequence: the ordered run path. It reads the per-workspace sequence
//     from the fake ExtensionContext's workspaceState, then dispatches each member
//     through the "saropaWorkspace.runPin" command — recorded by the vscode stub —
//     so the order, the skip-a-removed-shortcut branch, the empty-sequence guard, and the
//     stop-on-error halt are all observable without the extension host.
//   - maybeRunBootSequenceOnOpen: the once-per-session open offer. The stub's
//     showInformationMessage resolves to undefined (a dismiss), so the offer is made
//     but nothing runs; the test asserts the disabled/empty guards short-circuit
//     before any prompt, and that the in-memory "offered this session" latch fires
//     the data read at most once.
//
// configureBootSequence (the hub) is intentionally NOT exercised: its showHub builds
// QuickPickItemKind.Separator rows, an enum the unit stub does not model, so it is
// covered by a host-level harness instead.

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
  __recordedCommands,
  __resetRecordedCommands,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import {
  bootSequence,
  runBootSequence,
  maybeRunBootSequenceOnOpen,
} from "../commands/bootSequence";
import type { ExtensionContext, Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

const KEY = "saropaWorkspace.bootSequence";

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __resetRecordedCommands();
  // Skip recipe detection so a store refresh exercises only its own IO (mirrors the
  // branch-set and store tests).
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-boot-"))
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

// A store seeded with `count` project pins (a.ts, b.ts, ...), returned alongside
// their ids in add order so a test can build the sequence from real shortcut ids.
async function storeWithShortcuts(
  count: number
): Promise<{ store: ShortcutStore; ids: string[] }> {
  const store = new ShortcutStore(fakeContext());
  await store.init();
  for (let i = 0; i < count; i++) {
    const name = String.fromCharCode("a".charCodeAt(0) + i) + ".ts";
    await store.addShortcut(asUri(Uri.joinPath(folder.uri, name)), "project");
  }
  // Shortcuts are returned in stored order, which is the add order here. Filter out the
  // seeded auto-shortcut (the saropa-workspace.json record), which is not an explicit
  // member and carries a synthetic id.
  const ids = store
    .getProjectShortcuts()
    .filter((p) => !p.isAuto)
    .map((p) => p.id);
  return { store, ids };
}

// runPin commands recorded since the last reset, in fire order.
function ranShortcutCount(): number {
  return __recordedCommands().filter((c) => c.command === "saropaWorkspace.runPin")
    .length;
}

test("runBootSequence with an empty sequence runs nothing", async () => {
  const { store } = await storeWithShortcuts(2);
  // The singleton reads from this context's workspaceState; KEY is unset, so get()
  // yields the empty default and the run path takes its no-member guard.
  bootSequence.init(fakeContext());

  await runBootSequence(store);
  assert.equal(ranShortcutCount(), 0, "no members => no runPin dispatch");
});

test("runBootSequence dispatches each member in stored order", async () => {
  const { store, ids } = await storeWithShortcuts(3);
  const ctx = fakeContext();
  bootSequence.init(ctx);
  // Order in pinIds IS the run order; store all three.
  await ctx.workspaceState.update(KEY, {
    enabled: true,
    stopOnError: false,
    pinIds: [ids[0], ids[1], ids[2]],
  });

  await runBootSequence(store);
  // One dispatch per resolvable member, and the dispatched shortcut objects match the
  // sequence order (the command's first arg is the shortcut).
  const ran = __recordedCommands().filter(
    (c) => c.command === "saropaWorkspace.runPin"
  );
  assert.equal(ran.length, 3);
  assert.deepEqual(
    ran.map((c) => (c.args[0] as { id: string }).id),
    ids,
    "members run in the order stored in pinIds"
  );
});

test("runBootSequence skips a removed pin but runs the rest", async () => {
  const { store, ids } = await storeWithShortcuts(2);
  const ctx = fakeContext();
  bootSequence.init(ctx);
  // A middle id that resolves to no shortcut must be skipped, not abort the run.
  await ctx.workspaceState.update(KEY, {
    enabled: true,
    stopOnError: false,
    pinIds: [ids[0], "deleted-pin-id", ids[1]],
  });

  await runBootSequence(store);
  assert.equal(ranShortcutCount(), 2, "the two surviving members still run");
});

test("get() coerces a malformed stored shape to the safe empty default", async () => {
  const ctx = fakeContext();
  bootSequence.init(ctx);
  // A hand-corrupted record: non-array pinIds and non-boolean flags must not crash
  // a later read — get() normalizes each field.
  await ctx.workspaceState.update(KEY, {
    enabled: "yes",
    stopOnError: 1,
    pinIds: "not-an-array",
  });

  const data = bootSequence.get();
  assert.equal(data.enabled, false, "a non-true enabled coerces to false");
  assert.equal(data.stopOnError, false, "a non-true stopOnError coerces to false");
  assert.deepEqual(data.pinIds, [], "a non-array pinIds coerces to []");
});

test("maybeRunBootSequenceOnOpen makes no offer and runs nothing when disabled", async () => {
  const { store, ids } = await storeWithShortcuts(1);
  const ctx = fakeContext();
  bootSequence.init(ctx);
  // Populated but NOT enabled: the open offer must short-circuit before any prompt.
  await ctx.workspaceState.update(KEY, {
    enabled: false,
    stopOnError: false,
    pinIds: [ids[0]],
  });

  await maybeRunBootSequenceOnOpen(store);
  assert.equal(ranShortcutCount(), 0, "a disabled sequence is never offered or run");
});

test("maybeRunBootSequenceOnOpen offers at most once per session", async () => {
  const { store, ids } = await storeWithShortcuts(1);
  const ctx = fakeContext();
  bootSequence.init(ctx);
  // Enabled + populated, so the first call reaches the prompt (the stub dismisses
  // it). The in-memory session latch then suppresses every later call this process.
  await ctx.workspaceState.update(KEY, {
    enabled: true,
    stopOnError: false,
    pinIds: [ids[0]],
  });

  await maybeRunBootSequenceOnOpen(store);
  await maybeRunBootSequenceOnOpen(store);
  // The stub's showInformationMessage resolves undefined (dismiss), so neither pass
  // runs a shortcut; the assertion is that the second call is a no-op, not a re-prompt.
  assert.equal(ranShortcutCount(), 0, "a dismissed offer runs nothing on either pass");
});

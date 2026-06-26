// Path / environment / dependency field editors for the run-parameters hub
// (roadmap 2.1). Three editors plus one pure helper are under test:
//   - resolveDepName: the dependency pin's display name, resolved against a real
//     PinStore (label, else basename, else a placeholder when the id is gone).
//   - editEnv: the add/edit/delete environment-variable sub-hub, driven through the
//     stub's pick + input handlers across a couple of loop iterations.
//   - editDependsOn: pick a prerequisite pin (or clear it) from the cross-scope pin
//     list, returned by selecting a built item.
//
// editCwd's custom branch validates against workspace.fs.stat (modeled), so its
// preset rows are covered here; the editors touch only modeled API, so the real
// handler logic runs without the extension host.

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
import { PinStore } from "../model/pinStore";
import {
  resolveDepName,
  editEnv,
  editDependsOn,
  editCwd,
} from "../commands/configureRunEnv";
import type { PinExecConfig, Pin } from "../model/pin";
import type { Uri as VscodeUri } from "vscode";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  __resetHandlers();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-runenv-"))
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

// A store seeded with explicit project pins named after `names`. Each file is also
// written to disk so the pin resolves; returns the store plus the non-auto pins in
// add order.
async function storeWithPins(
  names: string[]
): Promise<{ store: PinStore; pins: Pin[] }> {
  const store = new PinStore(fakeContext());
  await store.init();
  for (const name of names) {
    nodeFs.writeFileSync(nodePath.join(tmpDir, name), "");
    await store.addPin(asUri(Uri.joinPath(folder.uri, name)), "project");
  }
  const pins = store.getProjectPins().filter((p) => !p.isAuto);
  return { store, pins };
}

test("resolveDepName returns the basename when a pin has no label", async () => {
  const { store, pins } = await storeWithPins(["build.ts"]);
  assert.equal(resolveDepName(store, pins[0].id), "build.ts");
});

test("resolveDepName falls back to a placeholder for an unknown id", async () => {
  const { store } = await storeWithPins(["a.ts"]);
  // The placeholder key is missing from no catalog, so l10n returns a non-empty
  // string; the contract under test is "does not throw and does not echo the id".
  const name = resolveDepName(store, "no-such-id");
  assert.ok(name.length > 0);
  assert.notEqual(name, "no-such-id");
});

test("editDependsOn sets the dependency to the picked pin's id", async () => {
  const { store, pins } = await storeWithPins(["a.ts", "b.ts"]);
  const subject = pins[0];
  const prerequisite = pins[1];
  // Select the row whose id is the prerequisite pin.
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ id?: string }>;
    return list.find((i) => i.id === prerequisite.id) as never;
  });
  const work: PinExecConfig = {};
  await editDependsOn(work, "Title", store, subject);
  assert.equal(work.dependsOn, prerequisite.id);
});

test("editDependsOn clears the dependency when the None row is picked", async () => {
  const { store, pins } = await storeWithPins(["a.ts", "b.ts"]);
  // The first item is the None row (id undefined); pick it to clear.
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ id?: string }>;
    return list.find((i) => i.id === undefined) as never;
  });
  const work: PinExecConfig = { dependsOn: pins[1].id };
  await editDependsOn(work, "Title", store, pins[0]);
  assert.equal(work.dependsOn, undefined);
});

test("editDependsOn never offers the pin itself as its own prerequisite", async () => {
  const { store, pins } = await storeWithPins(["solo.ts"]);
  // Only the subject pin exists, so the candidate list is just the None row — the
  // self-pin is excluded (a self-dependency is a guaranteed cycle).
  let offeredIds: Array<string | undefined> = [];
  __setPickHandler(async (items) => {
    offeredIds = (items as ReadonlyArray<{ id?: string }>).map((i) => i.id);
    return undefined; // cancel after inspecting the offered set
  });
  await editDependsOn({}, "Title", store, pins[0]);
  assert.ok(
    !offeredIds.includes(pins[0].id),
    "the subject pin must not appear as a candidate"
  );
});

test("editEnv adds a new KEY=value, then returns on Esc keeping the addition", async () => {
  const { store: _store } = await storeWithPins([]);
  // First loop: pick the Add row. Then the key prompt, then the value prompt. The
  // second loop: Esc (undefined pick) returns with the env retained on `work`.
  let pickCall = 0;
  __setPickHandler(async (items) => {
    pickCall += 1;
    if (pickCall === 1) {
      const list = items as ReadonlyArray<{ id?: string }>;
      return list.find((i) => i.id === "add") as never;
    }
    return undefined; // second iteration: leave the sub-hub
  });
  let inputCall = 0;
  __setInputHandler(async () => {
    inputCall += 1;
    return inputCall === 1 ? "API_URL" : "https://example.test";
  });
  const work: PinExecConfig = {};
  await editEnv(work, "Title");
  assert.deepEqual(work.env, { API_URL: "https://example.test" });
});

test("editEnv deletes an existing entry", async () => {
  await storeWithPins([]);
  // First loop: pick the var row; then the action sub-pick returns delete. Second
  // loop: Esc to leave.
  let pickCall = 0;
  __setPickHandler(async (items) => {
    pickCall += 1;
    const list = items as ReadonlyArray<{ id?: string }>;
    if (pickCall === 1) {
      return list.find((i) => i.id === "var:OLD") as never;
    }
    if (pickCall === 2) {
      return list.find((i) => i.id === "delete") as never;
    }
    return undefined; // leave the sub-hub
  });
  const work: PinExecConfig = { env: { OLD: "1", KEEP: "2" } };
  await editEnv(work, "Title");
  assert.deepEqual(work.env, { KEEP: "2" }, "only the chosen key is removed");
});

test("editCwd picks the workspace-root preset and stores its path", async () => {
  const { store, pins } = await storeWithPins(["a.ts"]);
  // The workspace row carries the owning folder's path as its value.
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ id?: string }>;
    return list.find((i) => i.id === "workspace") as never;
  });
  const work: PinExecConfig = {};
  await editCwd(work, "Title", store, pins[0]);
  assert.equal(work.cwd, tmpDir);
});

test("editCwd default row clears the working directory", async () => {
  const { store, pins } = await storeWithPins(["a.ts"]);
  __setPickHandler(async (items) => {
    const list = items as ReadonlyArray<{ id?: string }>;
    return list.find((i) => i.id === "default") as never;
  });
  const work: PinExecConfig = { cwd: "/somewhere" };
  await editCwd(work, "Title", store, pins[0]);
  assert.equal(work.cwd, undefined);
});

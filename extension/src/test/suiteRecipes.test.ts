// Suite-integration tests (roadmap "Better Together" — graceful absence + the
// per-tool subgroups). These run the REAL detector (detectSuiteRecipes) and the
// REAL store seeding: workspace.fs is the node filesystem against a temp dir, and
// vscode.extensions.getExtension is the settable stub, so detection branches on the
// same inputs the host gives it. Only the host SHELL is faked.
//
// Two layers are covered: the recipe layer (detectSuiteRecipes returns the right
// pins, tagged with the right subGroup, and nothing when no tool is present) and the
// store layer (the synthetic "Saropa Suite" group nests a subgroup per detected
// tool, the boot macro stays at the suite top level, and absence seeds nothing).

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
  __setInstalledExtensions,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { PinStore } from "../model/pinStore";
import { detectSuiteRecipes } from "../recipes/suiteRecipes";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const LINTS_EXT = "saropa.saropa-lints";
const DRIFT_EXT = "saropa.drift-viewer";
const LOG_EXT = "saropa.saropa-log-capture";
const SUITE_GROUP = "saropa-suite";
const SUITE_LINTS = "saropa-suite-lints";
const SUITE_DRIFT = "saropa-suite-drift";
const SUITE_LOG = "saropa-suite-log";

// The detector types its argument as the real vscode.WorkspaceFolder; the stub
// models only uri/name/index. Cast at the call site so tsc accepts the faithful stub.
const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-suite-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

const writePubspec = (body: string): void => {
  nodeFs.writeFileSync(nodePath.join(tmpDir, "pubspec.yaml"), body);
};

// Wait until a predicate holds, driven by the store's change event (recipe seeding
// is fired-and-forget from refresh and signals completion via onDidChange). A short
// timer fallback prevents a hung test if the predicate never becomes true.
const waitUntil = (
  store: PinStore,
  predicate: () => boolean
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }
    const sub = store.onDidChange(() => {
      if (predicate()) {
        sub.dispose();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error("timed out waiting for recipe seeding"));
    }, 3000);
  });

// --- detector layer ----------------------------------------------------

test("detectSuiteRecipes yields nothing when no tool is present (graceful absence)", async () => {
  // No pubspec, no installed sibling extensions: every push* branch returns early and
  // the boot macro needs 2+ tools, so the detector must produce an empty list and
  // never throw on the missing files it probes.
  __setInstalledExtensions([]);
  const results = await detectSuiteRecipes(asFolder(folder));
  assert.deepEqual(results, [], "absent suite should seed no recipes");
});

test("detectSuiteRecipes tags Lints CLI pins with the lints subGroup and seeds no other tool", async () => {
  // The package is in the project but no extension is installed: only the CLI pins
  // seed (the command pins are gated on the extension), and every one must carry the
  // per-tool subGroup so the store nests it under the Saropa Lints subfolder.
  writePubspec("name: app\ndependencies:\n  saropa_lints: ^1.0.0\n");
  __setInstalledExtensions([]);
  const results = await detectSuiteRecipes(asFolder(folder));

  assert.ok(results.length > 0, "the lints package should seed at least the CLI pins");
  assert.ok(
    results.every((r) => r.subGroup === "lints"),
    "every seeded pin should be tagged with the lints subGroup"
  );
  assert.ok(
    !results.some((r) => r.subGroup === "drift" || r.subGroup === "log"),
    "no drift/log pins should seed when only the lints package is present"
  );
});

test("detectSuiteRecipes seeds the boot macro (no subGroup) only with 2+ tools", async () => {
  // Two extensions installed -> the boot macro assembles. It must sit at the suite
  // top level (no subGroup), while each tool's command pins carry their own subGroup.
  __setInstalledExtensions([LINTS_EXT, LOG_EXT]);
  const results = await detectSuiteRecipes(asFolder(folder));

  const boot = results.find((r) => r.recipeId === "suite.boot");
  assert.ok(boot, "the boot macro should seed with two tools installed");
  assert.equal(boot!.subGroup, undefined, "the boot macro must stay at the suite top level");
  assert.ok(
    results.some((r) => r.recipeId.startsWith("suite.lints.") && r.subGroup === "lints"),
    "lints command pins should carry the lints subGroup"
  );
  assert.ok(
    results.some((r) => r.recipeId.startsWith("suite.log.") && r.subGroup === "log"),
    "log command pins should carry the log subGroup"
  );
});

// --- store layer (synthetic group nesting) -----------------------------

test("the store seeds no Saropa Suite group when no tool is detected", async () => {
  __setConfig("saropaWorkspace", "recipes.enabled", true);
  __setInstalledExtensions([]);
  const store = new PinStore(fakeContext());
  await store.init();
  // Wait for the (other, non-suite) recipes to seed so we assert on a settled tree.
  await waitUntil(store, () => store.getRecipeGroups().length > 0);

  assert.ok(
    !store.getRecipeGroups().some((g) => g.id === SUITE_GROUP),
    "the Saropa Suite group must not appear with no tool present"
  );
  assert.ok(
    !store.getRecipePins().some((p) => (p.groupId ?? "").startsWith(SUITE_GROUP)),
    "no suite pin should be seeded with no tool present"
  );
});

test("a detected tool materializes its subgroup nested under Saropa Suite", async () => {
  writePubspec("name: app\ndependencies:\n  saropa_lints: ^1.0.0\n");
  __setConfig("saropaWorkspace", "recipes.enabled", true);
  __setInstalledExtensions([]);
  const store = new PinStore(fakeContext());
  await store.init();
  await waitUntil(store, () =>
    store.getRecipeGroups().some((g) => g.id === SUITE_LINTS)
  );

  const groups = store.getRecipeGroups();
  const parent = groups.find((g) => g.id === SUITE_GROUP);
  const lints = groups.find((g) => g.id === SUITE_LINTS);
  assert.ok(parent, "the Saropa Suite parent group should exist");
  assert.equal(parent!.parentId, undefined, "the suite parent is top-level");
  assert.ok(lints, "the Saropa Lints subgroup should materialize");
  assert.equal(lints!.parentId, SUITE_GROUP, "the subgroup nests under the suite group");

  // The other tools were not detected, so their subgroups must be absent.
  assert.ok(
    !groups.some((g) => g.id === SUITE_DRIFT || g.id === SUITE_LOG),
    "undetected tools must not show a subgroup"
  );
  // The lints pins land in the subgroup, not flat in the suite group.
  assert.ok(
    store.getRecipePins().some((p) => p.groupId === SUITE_LINTS),
    "lints pins should be assigned to the lints subgroup"
  );
});

test("multiple detected tools nest as siblings with the boot macro at the suite top level", async () => {
  writePubspec(
    "name: app\ndependencies:\n  saropa_lints: ^1.0.0\n  saropa_drift_advisor: ^1.0.0\n"
  );
  __setConfig("saropaWorkspace", "recipes.enabled", true);
  __setInstalledExtensions([LINTS_EXT, DRIFT_EXT, LOG_EXT]);
  const store = new PinStore(fakeContext());
  await store.init();
  await waitUntil(store, () =>
    store.getRecipePins().some((p) => p.recipeId === "suite.boot")
  );

  const groups = store.getRecipeGroups();
  for (const id of [SUITE_LINTS, SUITE_DRIFT, SUITE_LOG]) {
    const sub = groups.find((g) => g.id === id);
    assert.ok(sub, `subgroup ${id} should exist`);
    assert.equal(sub!.parentId, SUITE_GROUP, `${id} should nest under the suite group`);
  }
  // The boot macro is a direct child of the suite group (top level), not a subgroup.
  const boot = store.getRecipePins().find((p) => p.recipeId === "suite.boot");
  assert.ok(boot, "the boot macro pin should be seeded");
  assert.equal(boot!.groupId, SUITE_GROUP, "the boot macro stays at the suite top level");
});

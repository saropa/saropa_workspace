// Unit tests for the workspace-hygiene recipe builder. detectHygieneRecipes takes
// no marker file — every project can be scanned — so it returns a fixed pair of
// recipes regardless of folder contents. The vscode import is type-only for this
// path, so it bundles and runs under Node's built-in runner with the vscode stub.
// The assertions pin the two recipes' routing (one in the Workspace group, one a
// disabled Scheduled bloat scan) and their command-pin shape, since those drive
// where the pins land in the tree and what they fire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Uri, type WorkspaceFolder } from "./_stub/vscode";
import { detectHygieneRecipes } from "../recipes/hygieneRecipes";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

// The detector ignores the folder (no file probing), so a bare stub folder suffices.
const folder: WorkspaceFolder = { uri: Uri.file("/tmp/proj"), name: "proj", index: 0 };

test("detectHygieneRecipes always returns the scan and the bloat recipe", async () => {
  // No gate: both recipes seed for any project, so the count is fixed at two.
  const results = await detectHygieneRecipes(asFolder(folder));
  assert.equal(results.length, 2);
  const ids = results.map((r) => r.recipeId).sort();
  assert.deepEqual(ids, ["hygiene.bloat", "hygiene.scan"]);
});

test("the file scan is a Workspace command pin (run on demand, not scheduled)", async () => {
  const scan = (await detectHygieneRecipes(asFolder(folder))).find(
    (r) => r.recipeId === "hygiene.scan"
  );
  assert.ok(scan, "the scan recipe should be present");
  assert.equal(scan!.group, "workspace");
  // A user-run crawl carries no schedule — it fires only when invoked.
  assert.equal(scan!.schedule, undefined);
  assert.deepEqual(scan!.action, {
    kind: "command",
    commandId: "saropaWorkspace.recipe.runHygieneScan",
  });
});

test("the bloat scan is a Scheduled recipe that seeds DISABLED", async () => {
  const bloat = (await detectHygieneRecipes(asFolder(folder))).find(
    (r) => r.recipeId === "hygiene.bloat"
  );
  assert.ok(bloat, "the bloat recipe should be present");
  assert.equal(bloat!.group, "scheduled");
  // Safety: a scheduled scan must never start running on its own until the user
  // promotes it, so it seeds with enabled:false at the pre-dawn 04:45 slot.
  assert.equal(bloat!.schedule?.enabled, false);
  assert.equal(bloat!.schedule?.atTime, "04:45");
  assert.equal(bloat!.action?.commandId, "saropaWorkspace.recipe.runBloatScan");
});

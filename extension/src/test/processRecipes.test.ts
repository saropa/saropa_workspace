// Unit tests for the developer-process-monitor recipe builder. detectProcessRecipes
// is unconditional — every dev machine runs processes, so there is no marker-file
// gate — and returns a fixed pair: the live monitor panel and the snapshot report.
// The vscode import is type-only here, so it runs under Node's built-in runner with
// the vscode stub. The assertions shortcut each recipe's monitor group routing and its
// command-shortcut target, since those decide where the pins land and what they invoke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Uri, type WorkspaceFolder } from "./_stub/vscode";
import { detectProcessRecipes } from "../recipes/processRecipes";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

// The detector does not read the folder, so a bare stub folder is enough.
const folder: WorkspaceFolder = { uri: Uri.file("/tmp/proj"), name: "proj", index: 0 };

test("detectProcessRecipes always returns the live monitor and the snapshot recipe", async () => {
  // Unconditional: both seed for any project, so the count is fixed at two.
  const results = await detectProcessRecipes(asFolder(folder));
  assert.equal(results.length, 2);
  const ids = results.map((r) => r.recipeId).sort();
  assert.deepEqual(ids, ["monitor.live", "monitor.snapshot"]);
});

test("both recipes land in the monitor group as command pins", async () => {
  const results = await detectProcessRecipes(asFolder(folder));
  // Every process recipe routes to the dedicated monitor top-level group.
  assert.ok(results.every((r) => r.group === "monitor"));
  assert.ok(results.every((r) => r.action?.kind === "command"));
});

test("the live monitor opens the process-monitor command", async () => {
  const live = (await detectProcessRecipes(asFolder(folder))).find(
    (r) => r.recipeId === "monitor.live"
  );
  assert.ok(live);
  assert.equal(live!.action?.commandId, "saropaWorkspace.openProcessMonitor");
});

test("the snapshot fires the snapshot-processes recipe command", async () => {
  const snap = (await detectProcessRecipes(asFolder(folder))).find(
    (r) => r.recipeId === "monitor.snapshot"
  );
  assert.ok(snap);
  assert.equal(snap!.action?.commandId, "saropaWorkspace.recipe.snapshotProcesses");
});

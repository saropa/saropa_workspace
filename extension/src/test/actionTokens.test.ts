// Tests for the recipe token expander and the dated report path template.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Uri, __setWorkspaceFolders } from "./_stub/vscode";
import { expandRecipeTokens, firstWorkspacePath, reportRelativePath } from "../exec/actionTokens";

beforeEach(() => __setWorkspaceFolders([{ uri: Uri.file("/work/app"), name: "app", index: 0 }]));
afterEach(() => __setWorkspaceFolders(undefined));

test("the report path template keeps the day folder, time and suffix in a fixed shape", () => {
  assert.equal(
    reportRelativePath("standup"),
    "reports/$datedir_workspace/$datedir_workspace_$time_standup.md"
  );
  assert.equal(reportRelativePath("data", "json"), "reports/$datedir_workspace/$datedir_workspace_$time_data.json");
});

test("a report path expands to a dated folder and a timed file name", () => {
  const expanded = expandRecipeTokens(reportRelativePath("ci"));
  assert.match(expanded, /^reports\/\d{4}\.\d{2}\.\d{2}_workspace\/\d{4}\.\d{2}\.\d{2}_workspace_\d{6}_ci\.md$/);
});

test("the workspace root and the date tokens expand together in one string", () => {
  const out = expandRecipeTokens("$workspaceRoot/out/$date/$time.log");
  assert.match(out, /^\/work\/app\/out\/\d{4}-\d{2}-\d{2}\/\d{6}\.log$/);
});

test("the stamp is the dated folder name, an underscore and the time", () => {
  const out = expandRecipeTokens("$datedir|$time|$stamp");
  const [datedir, time, stamp] = out.split("|");
  assert.equal(stamp, `${datedir}_${time}`);
  assert.match(stamp, /^\d{4}\.\d{2}\.\d{2}_\d{6}$/);
  assert.equal(stamp.slice(0, 10), datedir);
});

test("the first workspace folder is the root, and an unknown token is left alone", () => {
  assert.equal(firstWorkspacePath(), "/work/app");
  assert.equal(expandRecipeTokens("$workspaceRoot/$other"), "/work/app/$other");
});

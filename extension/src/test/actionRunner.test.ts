// Non-file recipe runner (url / shell / command / macro / routine). The run paths
// own child processes, terminals, and toasts and need the extension host, but two
// pure helpers are exported as the single source of truth for path resolution:
//   - firstWorkspacePath: the first open folder's fsPath, or undefined when none.
//   - expandRecipeTokens: substitute $workspaceRoot / $stamp / $date in a recipe's
//     shell line, cwd, and report path — the same expansion the dry-run audit reuses
//     so an actual run and a simulated one resolve identically.
// These are tested here with the settable workspace-folder stub; the token expansion
// is asserted by structure (the date stamps are clock-dependent) and by the literal
// $workspaceRoot substitution.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  Uri,
  __setWorkspaceFolders,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { expandRecipeTokens, firstWorkspacePath } from "../exec/actionRunner";

const ROOT = "/tmp/proj-root";
let folder: WorkspaceFolder;

beforeEach(() => {
  folder = { uri: Uri.file(ROOT), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
});

test("firstWorkspacePath returns the first folder's path, undefined when none open", () => {
  assert.equal(firstWorkspacePath(), ROOT);

  __setWorkspaceFolders(undefined);
  assert.equal(
    firstWorkspacePath(),
    undefined,
    "no open folder means there is no workspace root"
  );
});

test("$workspaceRoot expands to the first folder's path (every occurrence)", () => {
  assert.equal(
    expandRecipeTokens("$workspaceRoot/scripts/build.sh"),
    `${ROOT}/scripts/build.sh`
  );
  // Multiple occurrences are all substituted (split/join, not a single replace).
  assert.equal(
    expandRecipeTokens("$workspaceRoot:$workspaceRoot"),
    `${ROOT}:${ROOT}`
  );
});

test("$workspaceRoot expands to an empty string when no folder is open", () => {
  __setWorkspaceFolders(undefined);
  assert.equal(
    expandRecipeTokens("$workspaceRoot/out.log"),
    "/out.log",
    "with no root the token resolves to empty, never the literal token"
  );
});

test("$date expands to a YYYY-MM-DD calendar date", () => {
  const out = expandRecipeTokens("report-$date.md");
  const match = /^report-(\d{4})-(\d{2})-(\d{2})\.md$/.exec(out);
  assert.ok(match, `expected a dashed date, got "${out}"`);
  // The month/day are zero-padded two-digit fields.
  assert.equal(match![2].length, 2);
  assert.equal(match![3].length, 2);
});

test("$stamp expands to a filesystem-safe YYYY.MM.DD_HHmmss stamp", () => {
  const out = expandRecipeTokens("$stamp_hygiene.md");
  assert.ok(
    /^\d{4}\.\d{2}\.\d{2}_\d{6}_hygiene\.md$/.test(out),
    `expected a dotted stamp with a time suffix, got "${out}"`
  );
});

test("$datedir expands to a dotted YYYY.MM.DD folder name (not the dashed $date)", () => {
  const out = expandRecipeTokens("reports/$datedir/x.md");
  assert.ok(
    /^reports\/\d{4}\.\d{2}\.\d{2}\/x\.md$/.test(out),
    `expected a dotted date folder, got "${out}"`
  );
});

test("$datedir is replaced before $date, so the $date inside it is not consumed", () => {
  // "$date" is a prefix of "$datedir"; a wrong replacement order would leave a stray
  // "dir" or split the token. Both must resolve to dates of their own format.
  const out = expandRecipeTokens("$datedir|$date");
  assert.ok(
    /^\d{4}\.\d{2}\.\d{2}\|\d{4}-\d{2}-\d{2}$/.test(out),
    `expected "dotted|dashed", got "${out}"`
  );
});

test("$time expands to an HHmmss clock stamp", () => {
  const out = expandRecipeTokens("at-$time");
  assert.ok(/^at-\d{6}$/.test(out), `expected a 6-digit time, got "${out}"`);
});

test("a string with no tokens is returned unchanged", () => {
  assert.equal(expandRecipeTokens("npm run build"), "npm run build");
});

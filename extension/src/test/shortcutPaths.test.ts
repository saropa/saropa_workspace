// Unit tests for the global-shortcut path round-trip (shortcutPaths.ts). These touch
// vscode.Uri, which esbuild aliases to the test stub (src/test/_stub/vscode.ts)
// when bundling — so the tests verify the file/non-file BRANCH logic (which form
// is stored, which constructor is used) rather than real platform fsPath
// normalization, which is a host concern (4.2 integration).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Uri } from "vscode";
import { parseGlobalPath, globalStoredPath } from "../model/shortcutPaths";

test("globalStoredPath stores a local file as its plain fsPath", () => {
  // A local shortcut reads naturally and dedupes against older pins as a bare path.
  assert.equal(globalStoredPath(Uri.file("/home/me/a.ts")), "/home/me/a.ts");
});

test("globalStoredPath stores a non-file URI as its full string", () => {
  // A remote/virtual file must keep its scheme, so the whole URI is stored.
  const remote = Uri.parse("vscode-remote://ssh-remote+box/home/me/a.ts");
  assert.equal(globalStoredPath(remote), "vscode-remote://ssh-remote+box/home/me/a.ts");
});

test("parseGlobalPath reads a plain path back as a file URI", () => {
  const uri = parseGlobalPath("/home/me/a.ts");
  assert.equal(uri.scheme, "file");
});

test("parseGlobalPath: a Windows drive path is a file, not a URI", () => {
  // "C:\…" has a single colon but no "://", so it must not be mistaken for a URI.
  const uri = parseGlobalPath("C:\\src\\a.ts");
  assert.equal(uri.scheme, "file");
});

test("parseGlobalPath reads a scheme://... string back as that scheme", () => {
  const uri = parseGlobalPath("vscode-remote://ssh-remote+box/home/me/a.ts");
  assert.equal(uri.scheme, "vscode-remote");
});

test("round-trip: a non-file URI survives store -> parse unchanged", () => {
  const stored = globalStoredPath(Uri.parse("vscode-vfs://github/org/repo/x.ts"));
  const back = parseGlobalPath(stored);
  assert.equal(back.scheme, "vscode-vfs");
  assert.equal(back.toString(), "vscode-vfs://github/org/repo/x.ts");
});

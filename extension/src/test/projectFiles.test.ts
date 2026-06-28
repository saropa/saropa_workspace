// Unit tests for the Project Files model (model/projectFiles.ts): scanProjectFiles
// (stat each configured name under each folder, surface the ones that exist, read a
// version from version-bearing files) and the pure extractVersion parser. The scan
// runs against the fs-backed vscode stub over a real temp directory, so the actual
// stat/read path executes — only the host shell is faked. extractVersion is pure
// and tested directly with no filesystem.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  type WorkspaceFolder,
} from "./_stub/vscode";
import {
  scanProjectFiles,
  extractVersion,
  groupFilesByCategory,
  glyphForCategory,
  DEFAULT_PROJECT_FILE_GROUPS,
  type ProjectFileGroup,
  type ProjectFileInfo,
} from "../model/projectFiles";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

// The model types its folder argument as the real vscode.WorkspaceFolder; the stub
// models the slice the scan reads (uri / name). Cast at the call site.
const asFolders = (f: WorkspaceFolder[]): readonly VscodeFolder[] =>
  f as unknown as readonly VscodeFolder[];

// Wrap a flat list of paths as a single ad-hoc category, so the existing scan
// tests can pass names without restating the group shape each time.
const oneGroup = (
  category: string,
  ...files: string[]
): readonly ProjectFileGroup[] => [{ category, glyph: "package", files }];

let tmpDir: string;
let folder: WorkspaceFolder;

// Forward slashes so the stub Uri.joinPath and node fs agree on every OS.
beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-projfiles-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

const write = (rel: string, content: string): void => {
  const full = nodePath.join(tmpDir, rel);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, content);
};

test("scan surfaces only the configured files that actually exist", async () => {
  // A missing file is the normal case (stat throws) and is skipped silently; only
  // the present ones are surfaced.
  write("README.md", "# hi\n");
  write("package.json", '{ "version": "1.2.3" }\n');
  const results = await scanProjectFiles(
    asFolders([folder]),
    oneGroup("Project", "README.md", "package.json", "CHANGELOG.md")
  );
  const names = results.map((r) => r.name).sort();
  assert.deepEqual(names, ["README.md", "package.json"]);
});

test("scan reads a version from a version-bearing file and leaves others version-less", async () => {
  // Only the version-bearing set is read from disk; a plain doc is stat-only, so it
  // carries no version even when present.
  write("package.json", '{ "name": "x", "version": "4.5.6" }\n');
  write("README.md", "no version here\n");
  const results = await scanProjectFiles(
    asFolders([folder]),
    oneGroup("Project", "package.json", "README.md")
  );
  const pkg = results.find((r) => r.name === "package.json");
  const readme = results.find((r) => r.name === "README.md");
  assert.equal(pkg?.version, "4.5.6");
  assert.equal(readme?.version, undefined);
});

test("scan carries the owning folder name and the file mtime", async () => {
  // folderName groups rows when several folders are open; modified reflects live
  // edits (file mtime), which is what answers "is the changelog current".
  write("CHANGELOG.md", "## [2.0.0] - 2026-06-25\n");
  const results = await scanProjectFiles(
    asFolders([folder]),
    oneGroup("Project", "CHANGELOG.md")
  );
  const info = results[0] as ProjectFileInfo;
  assert.equal(info.folderName, "proj");
  // The surfacing category is carried on every result so the view can group by it.
  assert.equal(info.category, "Project");
  assert.equal(typeof info.modified, "number");
  assert.ok(info.modified > 0, "mtime should be a real epoch-ms value");
  // CHANGELOG is version-bearing: the first real release heading is reported.
  assert.equal(info.version, "2.0.0");
});

test("a directory named like a candidate is ignored (file type guard)", async () => {
  // A folder named "LICENSE" must not be surfaced — only a real file qualifies.
  nodeFs.mkdirSync(nodePath.join(tmpDir, "LICENSE"), { recursive: true });
  const results = await scanProjectFiles(
    asFolders([folder]),
    oneGroup("Project", "LICENSE")
  );
  assert.equal(results.length, 0, "a directory matching a candidate name is skipped");
});

test("a malformed manifest surfaces the file with no version rather than throwing", async () => {
  // One bad manifest must not break the whole view: it is surfaced version-less.
  write("package.json", "{ this is not valid json ");
  const results = await scanProjectFiles(
    asFolders([folder]),
    oneGroup("Project", "package.json")
  );
  assert.equal(results.length, 1, "the malformed file is still surfaced");
  assert.equal(results[0].version, undefined);
});

test("the default catalog spans the common manifests, docs, and platform configs", () => {
  // Flatten the curated groups and assert the load-bearing members are present:
  // the cross-stack root manifests/docs in Project, plus the curated Android core
  // (including a nested path) so the catalog actually reaches into subfolders.
  const byCategory = new Map(
    DEFAULT_PROJECT_FILE_GROUPS.map((g) => [g.category, g.files])
  );
  for (const name of ["README.md", "CHANGELOG.md", "package.json", "pubspec.yaml", "analysis_options.yaml"]) {
    assert.ok(
      byCategory.get("Project")?.includes(name),
      `Project group should include ${name}`
    );
  }
  assert.ok(
    byCategory.get("Android")?.includes("android/app/build.gradle"),
    "Android group should reach the nested app build.gradle"
  );
  assert.ok(byCategory.has("iOS"), "catalog carries an iOS group");
  assert.ok(byCategory.has("Web"), "catalog carries a Web group");
});

test("scan tags each file with the category that surfaced it and reaches nested paths", async () => {
  // A nested path under a category surfaces by its full relative name and carries
  // the owning category, which is what lets the view group it under "Android".
  write("android/app/build.gradle", "// app gradle\n");
  write("README.md", "# hi\n");
  const groups: readonly ProjectFileGroup[] = [
    { category: "Project", glyph: "package", files: ["README.md"] },
    { category: "Android", glyph: "device-mobile", files: ["android/app/build.gradle"] },
  ];
  const results = await scanProjectFiles(asFolders([folder]), groups);
  const gradle = results.find((r) => r.name === "android/app/build.gradle");
  assert.equal(gradle?.category, "Android");
  const readme = results.find((r) => r.name === "README.md");
  assert.equal(readme?.category, "Project");
});

// --- groupFilesByCategory (pure grouping) --------------------------------

// A minimal ProjectFileInfo for the pure grouping tests — only category is read.
const infoIn = (category: string, name: string): ProjectFileInfo =>
  ({ category, name } as unknown as ProjectFileInfo);

test("groupFilesByCategory buckets in catalog order and drops empty categories", () => {
  const found = [
    infoIn("Android", "android/build.gradle"),
    infoIn("Project", "README.md"),
    infoIn("Android", "android/gradle.properties"),
  ];
  // Order lists iOS before it has any files: an empty category must not appear.
  const grouped = groupFilesByCategory(found, ["Project", "Android", "iOS"]);
  assert.deepEqual(grouped.map((g) => g.category), ["Project", "Android"]);
  assert.equal(grouped[1].files.length, 2, "both Android files land in one bucket");
});

test("groupFilesByCategory keeps a user-defined category after the known ones", () => {
  const found = [infoIn("Project", "README.md"), infoIn("Custom", "notes.md")];
  const grouped = groupFilesByCategory(found, ["Project", "Android"]);
  // "Custom" is not in the supplied order, so it follows the ordered groups.
  assert.deepEqual(grouped.map((g) => g.category), ["Project", "Custom"]);
});

test("glyphForCategory returns the catalog glyph for a known category, folder for unknown", () => {
  assert.equal(glyphForCategory("Web"), "globe");
  assert.equal(glyphForCategory("Android"), "device-mobile");
  // An unknown (user-defined) category falls back to the generic folder glyph
  // rather than an id that would render blank.
  assert.equal(glyphForCategory("Whatever"), "folder");
});

// --- extractVersion (pure parser) ---------------------------------------

test("extractVersion: package.json reads the string version, ignores a non-string", () => {
  assert.equal(extractVersion("package.json", '{ "version": "1.0.0" }'), "1.0.0");
  // A numeric/absent version yields no string, so the file surfaces version-less.
  assert.equal(extractVersion("package.json", '{ "version": 5 }'), undefined);
  assert.equal(extractVersion("package.json", "{}"), undefined);
});

test("extractVersion: pubspec.yaml reads an unquoted top-level version line", () => {
  // YAML values may be unquoted; a build-number suffix is part of the version token.
  assert.equal(extractVersion("pubspec.yaml", "name: app\nversion: 2.3.4+12\n"), "2.3.4+12");
});

test("extractVersion: Cargo.toml and pyproject.toml read a quoted version", () => {
  assert.equal(extractVersion("Cargo.toml", 'version = "0.9.1"\n'), "0.9.1");
  assert.equal(extractVersion("pyproject.toml", 'version = "3.0.0"\n'), "3.0.0");
});

test("extractVersion: CHANGELOG skips the Unreleased placeholder and reports the newest release", () => {
  // The first heading with a leading digit wins, so the conventional [Unreleased]
  // placeholder is skipped and the newest real release is what shows.
  const text = "# Changelog\n\n## [Unreleased]\n\n## [1.5.0] - 2026-06-25\n\n## [1.4.0]\n";
  assert.equal(extractVersion("CHANGELOG.md", text), "1.5.0");
  // A `v`-prefixed bare heading is handled too.
  assert.equal(extractVersion("CHANGELOG.md", "## v2.0.1\n"), "2.0.1");
});

test("extractVersion: an unknown file type yields no version", () => {
  // Only the dispatch's known formats parse; anything else is version-less.
  assert.equal(extractVersion("README.md", "## 1.0.0\n"), undefined);
});

// Changelog check and Version consistency: reading versions, comparing them, and the report text.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeVersions,
  buildChangelogMarkdown,
  buildVersionMarkdown,
  cargoLockVersion,
  changelogSummaryLine,
  checkChangelog,
  checkVersions,
  cleanRelativeFile,
  firstManifestVersion,
  normalizeVersion,
  packageLockVersions,
  readManifest,
  topChangelogVersion,
  versionSummaryLine,
} from "../exec/versionChecks";

const T = Date.parse("2026-10-27T05:30:12.000Z");

test("versions compare without a leading v or build metadata", () => {
  assert.equal(normalizeVersion(" v1.2.3+45 "), "1.2.3");
  assert.equal(normalizeVersion("1.2.3-beta.1"), "1.2.3-beta.1");
});

test("the top changelog entry is the first heading with a version; Unreleased is skipped", () => {
  const text = "# Changelog\n\nintro 9.9.9\n\n## [Unreleased]\n\n### Added\n\n## [2.1.0] - 2026-10-01\n\n## [2.0.0]\n";
  assert.equal(topChangelogVersion(text), "2.1.0");
  assert.equal(topChangelogVersion("## v3.0.0-rc.1\n"), "3.0.0-rc.1");
  assert.equal(topChangelogVersion("### 1.4.2 (2025-01-02)\n"), "1.4.2");
  assert.equal(topChangelogVersion("# Changelog\n\n## [Unreleased]\n"), undefined);
  assert.equal(topChangelogVersion(""), undefined);
});

test("manifests: the version of each kind of file; none when it has none", () => {
  assert.deepEqual(readManifest("package.json", '{"name":"w","version":"1.0.0"}'), { file: "package.json", version: "1.0.0", name: "w" });
  assert.equal(readManifest("package.json", '{"name":"w","private":true}'), undefined);
  assert.equal(readManifest("package.json", "{ broken"), undefined);
  assert.deepEqual(readManifest("pubspec.yaml", "name: app\nversion: 2.3.4+7 # build\n"), { file: "pubspec.yaml", version: "2.3.4+7", name: "app" });
  assert.deepEqual(readManifest("Cargo.toml", '[package]\nname = "crate"\nversion = "0.4.1"\n\n[dependencies]\nserde = { version = "1.0.0" }\n'), { file: "Cargo.toml", version: "0.4.1", name: "crate" });
  assert.equal(readManifest("Cargo.toml", '[package]\nname = "c"\nversion.workspace = true\n[dependencies]\nx = { version = "1.0.0" }\nversion = "9.9.9"\n'), undefined);
  assert.deepEqual(readManifest("pyproject.toml", '[project]\nname = "lib"\nversion = "1.1.0"\n'), { file: "pyproject.toml", version: "1.1.0", name: "lib" });
  assert.deepEqual(readManifest("pyproject.toml", '[tool.poetry]\nname = "lib"\nversion = "1.2.0"\n'), { file: "pyproject.toml", version: "1.2.0", name: "lib" });
});

test("the first manifest with a version wins, in the usual order", () => {
  const files = [
    { file: "pyproject.toml", text: '[project]\nversion = "3.0.0"\n' },
    { file: "package.json", text: '{"private":true}' },
    { file: "pubspec.yaml", text: "version: 2.0.0\n" },
  ];
  assert.equal(firstManifestVersion(files)?.file, "pubspec.yaml");
  assert.equal(firstManifestVersion([]), undefined);
});

test("lockfiles: the project's own version, from the top level and the root package; Cargo.lock by crate name", () => {
  assert.deepEqual(packageLockVersions('{"name":"w","version":"1.0.1","packages":{"":{"version":"1.0.2"},"node_modules/x":{"version":"9.0.0"}}}'), [
    { source: "package-lock.json", version: "1.0.1" },
    { source: "package-lock.json (root package)", version: "1.0.2" },
  ]);
  assert.deepEqual(packageLockVersions("{ broken"), []);
  const lock = '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "crate"\nversion = "0.4.0"\n';
  assert.deepEqual(cargoLockVersion(lock, "crate"), [{ source: "Cargo.lock", version: "0.4.0" }]);
  assert.deepEqual(cargoLockVersion(lock, "cr.te"), []);
  assert.deepEqual(cargoLockVersion(lock, undefined), []);
});

test("README badges: only badges about the version or release that carry a number", () => {
  const readme = [
    "![Version 2.1.0](https://example.com/v.svg)",
    "![npm](https://img.shields.io/badge/version-2.1.1-blue)",
    "![pre](https://img.shields.io/badge/release-3.0.0--rc.1-orange)",
    "![node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)",
    "![dynamic](https://img.shields.io/npm/v/pkg)",
    "![Release](https://example.com/release.svg)",
    "text ![vscode](https://img.shields.io/badge/vscode-1.80.0-blue)",
  ].join("\n");
  assert.deepEqual(badgeVersions(readme).map((b) => b.version), ["2.1.0", "2.1.1", "3.0.0-rc.1"]);
});

test("version consistency: agreeing files pass, each file that differs is counted, and one source alone cannot say", () => {
  const manifest = { file: "package.json", version: "1.2.3" };
  const pass = checkVersions(manifest, [{ source: "package-lock.json", version: "1.2.3" }, { source: "README badge", version: "v1.2.3" }]);
  assert.deepEqual([pass.result, pass.count], ["pass", 0]);
  const fail = checkVersions(manifest, [{ source: "package-lock.json", version: "1.2.2" }, { source: "README badge", version: "1.2.3" }, { source: "Cargo.lock", version: "0.0.1" }]);
  assert.deepEqual([fail.result, fail.count], ["fail", 2]);
  assert.deepEqual(fail.rows.map((r) => r.agrees), [false, true, false]);
  assert.equal(checkVersions(manifest, []).result, "unknown");
  assert.equal(checkVersions(undefined, [{ source: "README badge", version: "1.0.0" }]).result, "unknown");
});

test("changelog check: equal passes, different fails, a missing side is unknown", () => {
  const m = { file: "package.json", version: "2.1.0" };
  assert.equal(checkChangelog("2.1.0", m).result, "pass");
  assert.equal(checkChangelog("v2.1.0", { ...m, version: "2.1.0+5" }).result, "pass");
  assert.equal(checkChangelog("2.0.0", m).result, "fail");
  assert.equal(checkChangelog("2.2.0", m).result, "fail", "a changelog ahead of the manifest also differs");
  assert.equal(checkChangelog(undefined, m).result, "unknown");
  assert.equal(checkChangelog("2.1.0", undefined).result, "unknown");
});

test("summary lines and reports, exact", () => {
  const m = { file: "package.json", version: "2.1.0" };
  assert.equal(changelogSummaryLine(checkChangelog("2.0.0", m), T), "<!-- saropa-summary recipe=ritual.changelog time=2026-10-27T05:30:12.000Z result=fail count=1 -->");
  assert.equal(changelogSummaryLine(checkChangelog("2.1.0", m), T), "<!-- saropa-summary recipe=ritual.changelog time=2026-10-27T05:30:12.000Z result=pass count=0 -->");
  assert.equal(changelogSummaryLine(checkChangelog(undefined, m), T), "<!-- saropa-summary recipe=ritual.changelog time=2026-10-27T05:30:12.000Z result=unknown -->");
  const v = checkVersions(m, [{ source: "package-lock.json", version: "2.0.9" }]);
  assert.equal(versionSummaryLine(v, T), "<!-- saropa-summary recipe=ritual.version time=2026-10-27T05:30:12.000Z result=fail count=1 -->");
  assert.equal(versionSummaryLine(checkVersions(m, []), T), "<!-- saropa-summary recipe=ritual.version time=2026-10-27T05:30:12.000Z result=unknown -->");
  const md = buildVersionMarkdown(v, "NOW");
  assert.ok(md.includes("| package.json (manifest) | 2.1.0 | reference |"));
  assert.ok(md.includes("| package-lock.json | 2.0.9 | **differs** |"));
  assert.ok(md.includes("**Result:** 1 file(s) state a different version."));
  const cl = buildChangelogMarkdown(checkChangelog("2.0.0", m), "docs|log.md", "NOW");
  assert.ok(cl.includes("| docs\\|log.md (newest released entry) | 2.0.0 |"));
  assert.ok(cl.includes("does not match"));
});

test("a configured file name stays inside the project folder", () => {
  assert.equal(cleanRelativeFile("docs\\CHANGES.md", "CHANGELOG.md"), "docs/CHANGES.md");
  assert.equal(cleanRelativeFile("./CHANGES.md", "CHANGELOG.md"), "CHANGES.md");
  for (const bad of ["../x.md", "/etc/passwd", "C:\\x.md", "a/../../b", "", "  ", 5, undefined]) {
    assert.equal(cleanRelativeFile(bad, "CHANGELOG.md"), "CHANGELOG.md", String(bad));
  }
});

test("a crate name with a backslash is looked up literally", () => {
  const lock = '[[package]]\nname = "a\\\\b"\nversion = "1.2.3"\n\n[[package]]\nname = "ab"\nversion = "9.9.9"\n';
  assert.deepEqual(cargoLockVersion(lock, "a\\\\b"), [{ source: "Cargo.lock", version: "1.2.3" }]);
  assert.deepEqual(cargoLockVersion(lock, "a.b"), []);
});

test("report tables escape a backslash in a source name", () => {
  const md = buildVersionMarkdown({ result: "fail", count: 1, manifest: { file: "package.json", version: "1.0.0" }, rows: [{ source: "dir\\lock.json", version: "2.0.0", agrees: false }] }, "NOW");
  assert.ok(md.includes("| dir\\\\lock.json | 2.0.0 | **differs** |"));
});

// The bound only guards against catastrophic (quadratic) backtracking, which takes minutes, so it
// is deliberately generous: a loaded dev or CI machine must not fail it.
test("badge reading stays fast on 200,000 repetitions of the image opener", () => {
  const start = Date.now();
  assert.deepEqual(badgeVersions("![".repeat(200000)), []);
  assert.equal(badgeVersions("![version 1.2.3](".repeat(20000) + "x").length, 10000);
  assert.ok(Date.now() - start < 30000, `took ${Date.now() - start} ms`);
});

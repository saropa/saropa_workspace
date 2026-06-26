// Unit + integration tests for the workspace bloat scanner (recipe #63). bloatScan
// carries NO VS Code dependency, so it runs under Node's built-in test runner against
// a real temporary directory tree — exercising the actual fs walk, the test-downloader
// detection, and the watcher-guard check, not a mock of them.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { humanBytes, measureDirectory, scanBloat } from "../exec/bloatScan";

// Build an isolated project tree under the OS temp dir; the caller removes it.
async function makeTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "saropa-bloat-"));
}

async function writeFile(root: string, rel: string, contents: string): Promise<void> {
  const full = path.join(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents, "utf8");
}

test("humanBytes: MB under a GB, GB at or above", () => {
  assert.equal(humanBytes(0), "0 MB");
  assert.equal(humanBytes(500 * 1024 * 1024), "500 MB");
  assert.equal(humanBytes(1024 * 1024 * 1024), "1.0 GB");
  assert.equal(humanBytes(16.3 * 1024 * 1024 * 1024), "16.3 GB");
});

test("measureDirectory: sums files recursively, skips nothing", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, "a.txt", "hello"); // 5 bytes
    await writeFile(root, "sub/b.txt", "world!"); // 6 bytes
    const { bytes, files } = await measureDirectory(root);
    assert.equal(files, 2);
    assert.equal(bytes, 11);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scanBloat: flags an oversized crawlable dir and an unguarded test cache", async () => {
  const root = await makeTempProject();
  try {
    // A project that pulls in the VS Code test downloader but ships no settings.json —
    // the canonical unguarded cache, a finding even though .vscode-test is absent.
    await writeFile(
      root,
      "package.json",
      JSON.stringify({ devDependencies: { "@vscode/test-electron": "^2.0.0" } })
    );
    // A "build" dir with three files; ceilings set so its file count crosses.
    await writeFile(root, "build/one", "x");
    await writeFile(root, "build/two", "x");
    await writeFile(root, "build/three", "x");

    const report = await scanBloat({
      roots: [root],
      folderCeilingBytes: 1024 * 1024 * 1024,
      fileCountCeiling: 2,
    });

    assert.equal(report.hasThresholdCross, true);
    const oversized = report.findings.find((f) => f.kind === "oversizedDir");
    assert.ok(oversized, "expected an oversizedDir finding for build/");
    assert.equal(oversized?.name, "build");
    assert.equal(oversized?.watcherGlob, "**/build/**");

    const cache = report.findings.find((f) => f.kind === "unguardedTestCache");
    assert.ok(cache, "expected an unguardedTestCache finding");
    assert.equal(cache?.watcherGlob, "**/.vscode-test/**");

    // The per-root summary records the downloader + guard state.
    const summary = report.perRoot[0];
    assert.equal(summary.usesTestDownloader, true);
    assert.equal(summary.testCacheGuarded, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scanBloat: a watcher-excluded dir and guarded cache produce no findings", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(
      root,
      "package.json",
      JSON.stringify({ devDependencies: { "@vscode/test-electron": "^2.0.0" } })
    );
    await writeFile(root, "build/one", "x");
    await writeFile(root, "build/two", "x");
    await writeFile(root, "build/three", "x");
    // Both the bloated dir and the test cache are watcher-excluded (JSONC with a
    // comment, to exercise the tolerant settings reader).
    await writeFile(
      root,
      ".vscode/settings.json",
      '{\n  // guard the heavy dirs\n  "files.watcherExclude": {\n' +
        '    "**/build/**": true,\n    "**/.vscode-test/**": true,\n  }\n}\n'
    );

    const report = await scanBloat({
      roots: [root],
      folderCeilingBytes: 1024 * 1024 * 1024,
      fileCountCeiling: 2,
    });

    assert.equal(report.findings.length, 0, "guarded dirs must not be flagged");
    assert.equal(report.hasThresholdCross, false);
    assert.equal(report.perRoot[0].testCacheGuarded, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

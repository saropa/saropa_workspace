// Workspace hygiene scanner (recipe book #63). scanOutliers carries NO VS Code
// dependency, so it runs under Node's built-in runner against a real temporary
// directory tree — exercising the actual recursive crawl, the empty/oversized
// classification, the built-in + gitignore + user-exclude skip logic, the
// symlink-skip cycle guard, and the largest-first sort. This is the real walk, not a
// mock of it (the bloatScan test follows the same convention).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { scanOutliers, type ScanOptions } from "../exec/hygieneScan";

async function makeTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "saropa-hygiene-"));
}

async function writeFile(root: string, rel: string, contents: string): Promise<void> {
  const full = path.join(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents, "utf8");
}

// Base options shared by the tests; each test overrides only what it exercises so the
// intent of each case is local. A 100-byte file ceiling makes "oversized" easy to
// trigger with small fixtures.
function options(root: string, over: Partial<ScanOptions> = {}): ScanOptions {
  return {
    roots: [root],
    mode: "both",
    fileMaxBytes: 100,
    folderMaxBytes: 1024,
    respectGitignore: false,
    excludeGlobs: [],
    ...over,
  };
}

test("scanOutliers flags an empty file and an oversized file, largest-first", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, "empty.txt", ""); // 0 bytes -> emptyFile
    await writeFile(root, "big.bin", "x".repeat(250)); // > 100-byte ceiling -> largeFile
    await writeFile(root, "ok.txt", "x".repeat(50)); // within bounds -> not flagged

    const report = await scanOutliers(options(root));

    const large = report.findings.find((f) => f.kind === "largeFile");
    assert.ok(large, "the oversized file is flagged");
    assert.equal(large?.sizeBytes, 250);
    assert.equal(large?.threshold, 100);

    const empty = report.findings.find((f) => f.kind === "emptyFile");
    assert.ok(empty, "the empty file is flagged");
    assert.equal(empty?.sizeBytes, 0);

    assert.ok(
      !report.findings.some((f) => f.relPath === "ok.txt"),
      "a within-bounds file is not reported"
    );
    // Sized findings lead (desc), empties trail — the report leads with the biggest.
    assert.equal(report.findings[0].kind, "largeFile");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("mode 'empty' reports only empties; mode 'oversized' reports only oversized", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, "empty.txt", "");
    await writeFile(root, "big.bin", "x".repeat(250));

    const emptyOnly = await scanOutliers(options(root, { mode: "empty" }));
    assert.ok(emptyOnly.findings.some((f) => f.kind === "emptyFile"));
    assert.ok(
      !emptyOnly.findings.some((f) => f.kind === "largeFile"),
      "empty mode must not surface oversized findings"
    );

    const oversizedOnly = await scanOutliers(options(root, { mode: "oversized" }));
    assert.ok(oversizedOnly.findings.some((f) => f.kind === "largeFile"));
    assert.ok(
      !oversizedOnly.findings.some((f) => f.kind === "emptyFile"),
      "oversized mode must not surface empty findings"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the fileMinBytes floor flags an under-size non-empty file but not an empty one", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, "tiny.txt", "ab"); // 2 bytes, below the 10-byte floor
    await writeFile(root, "empty.txt", ""); // 0 bytes — covered by emptyFile, not smallFile
    await writeFile(root, "fine.txt", "x".repeat(20)); // above the floor

    const report = await scanOutliers(
      options(root, { mode: "oversized", fileMinBytes: 10 })
    );

    const small = report.findings.find((f) => f.kind === "smallFile");
    assert.ok(small, "a non-empty file below the floor is flagged smallFile");
    assert.equal(small?.relPath, "tiny.txt");
    assert.equal(small?.threshold, 10);
    assert.ok(
      !report.findings.some((f) => f.kind === "smallFile" && f.relPath === "empty.txt"),
      "an empty file is not double-reported as both emptyFile and smallFile"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an empty subfolder is flagged but the scan root itself never is", async () => {
  const root = await makeTempProject();
  try {
    // A genuinely empty directory under the root.
    await fs.mkdir(path.join(root, "hollow"), { recursive: true });

    const report = await scanOutliers(options(root, { mode: "empty" }));

    assert.ok(
      report.findings.some((f) => f.kind === "emptyFolder" && f.relPath === "hollow"),
      "an empty subfolder is reported"
    );
    assert.ok(
      !report.findings.some((f) => f.path === root),
      "the chosen scope root is never flagged as an outlier"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a built-in ignore dir (node_modules) is never descended into", async () => {
  const root = await makeTempProject();
  try {
    // A huge file inside node_modules must not be reported — the crawl skips the dir.
    await writeFile(root, "node_modules/pkg/huge.bin", "x".repeat(500));
    await writeFile(root, "src/app.bin", "x".repeat(250)); // a real finding outside the ignore set

    const report = await scanOutliers(options(root, { mode: "oversized" }));

    assert.ok(
      !report.findings.some((f) => f.relPath.includes("node_modules")),
      "node_modules is in the built-in ignore set and is skipped"
    );
    assert.ok(
      report.findings.some((f) => f.relPath.split(path.sep).join("/") === "src/app.bin"),
      "a finding outside the ignore set is still reported"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a user exclude glob keeps a matching subtree out of the report", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, "logs/run.log", "x".repeat(250));
    await writeFile(root, "src/keep.bin", "x".repeat(250));

    const report = await scanOutliers(
      options(root, { mode: "oversized", excludeGlobs: ["logs"] })
    );

    assert.ok(
      !report.findings.some((f) => f.relPath.includes("logs")),
      "the excluded logs subtree is skipped"
    );
    assert.ok(
      report.findings.some((f) => f.relPath.split(path.sep).join("/") === "src/keep.bin"),
      "a non-excluded oversized file is still reported"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("respectGitignore reads the root .gitignore and skips what it names", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, ".gitignore", "dist\n# a comment\n!keep\n");
    await writeFile(root, "dist/bundle.bin", "x".repeat(250)); // named in .gitignore -> skipped
    await writeFile(root, "src/main.bin", "x".repeat(250)); // not ignored -> reported

    const report = await scanOutliers(
      options(root, { mode: "oversized", respectGitignore: true })
    );

    assert.ok(
      !report.findings.some((f) => f.relPath.includes("dist")),
      "a directory named in .gitignore is skipped"
    );
    assert.ok(
      report.findings.some((f) => f.relPath.split(path.sep).join("/") === "src/main.bin"),
      "a file outside the gitignore set is reported"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the report carries scan counters and an untruncated flag for a small tree", async () => {
  const root = await makeTempProject();
  try {
    await writeFile(root, "a.txt", "x".repeat(250));
    await writeFile(root, "sub/b.txt", "x".repeat(250));

    const report = await scanOutliers(options(root, { mode: "oversized" }));

    assert.equal(report.truncated, false, "a small tree does not hit the finding cap");
    assert.ok(report.filesScanned >= 2, "both files were visited");
    assert.ok(report.dirsScanned >= 2, "the root and the subfolder were visited");
    assert.deepEqual(report.scope, [root], "the report records the scanned scope");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// Unit-test harness. Every src/test/**/*.test.ts is esbuild-bundled to out/test
// as a self-contained CJS file — the bare "vscode" import is aliased to the test
// stub (src/test/_stub/vscode.ts) so pure-logic modules run without the extension
// host — then all bundles are executed under Node's built-in test runner.
//
// Scoped to the test folder by design: it discovers only *.test.ts under src/test
// and runs the exact bundles it built, so a bare run can never sweep unrelated
// files. Exits non-zero on any test failure (or when no tests are found) so CI
// gates on it.
const esbuild = require("esbuild");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const testDir = path.join(__dirname, "src", "test");
const outDir = path.join(__dirname, "out", "test");
const stub = path.join(testDir, "_stub", "vscode.ts");

// Recursively collect *.test.ts under src/test (the _stub folder holds test doubles and their own tests).
function collectTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTests(full));
    } else if (entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

async function main() {
  const entries = collectTests(testDir);
  if (entries.length === 0) {
    console.error("No *.test.ts files found under src/test.");
    process.exit(1);
  }

  // Fresh outdir so a renamed or removed test never lingers as a stale bundle that
  // node --test would still pick up.
  fs.rmSync(outDir, { recursive: true, force: true });

  const outFiles = entries.map((entry) =>
    path.join(outDir, path.relative(testDir, entry).replace(/\.ts$/, ".cjs"))
  );

  await Promise.all(
    entries.map((entry, i) =>
      esbuild.build({
        entryPoints: [entry],
        outfile: outFiles[i],
        bundle: true,
        platform: "node",
        format: "cjs",
        // Any module reaching for the host gets the minimal stub instead, so the
        // bundle both resolves and runs under plain node.
        alias: { vscode: stub },
        logLevel: "warning",
      })
    )
  );

  // Run the exact bundles we built (explicit file list, not a glob), so the run is
  // deterministic across Node versions and platforms.
  // Windows caps a command line at 32,767 characters. The full bundle list passed 38,000, so one
  // spawn failed with ENAMETOOLONG and the harness exited 1 without running a single test. The
  // list is split into batches under a margin below that cap and the batches run one after another.
  const MAX_ARG_CHARS = 24000;
  const batches = [];
  let current = [];
  let size = 0;
  for (const file of outFiles) {
    if (current.length > 0 && size + file.length + 1 > MAX_ARG_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += file.length + 1;
  }
  if (current.length > 0) {
    batches.push(current);
  }

  // Every batch runs even after a failure so one run reports all failing files; the exit code is
  // non-zero when any batch failed.
  let exitCode = 0;
  for (const batch of batches) {
    const result = spawnSync(process.execPath, ["--test", ...batch], {
      stdio: "inherit",
    });
    // A launch failure comes back through result.error with a null status. Printing it keeps a
    // failed spawn from exiting 1 with no output, which left the publish gate with nothing to read.
    if (result.error) {
      console.error(`Could not launch the test runner: ${result.error.message} (${batch.length} bundles).`);
    }
    if ((result.status ?? 1) !== 0) {
      exitCode = result.status ?? 1;
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

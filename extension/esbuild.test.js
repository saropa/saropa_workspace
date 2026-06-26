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

// Recursively collect *.test.ts under src/test (the _stub folder carries no tests).
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
  const result = spawnSync(process.execPath, ["--test", ...outFiles], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

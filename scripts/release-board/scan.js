// Manual scan of real repos with the Release Board engine (not a test: the repos live
// outside this one and their counts change with every commit).
//
//   node scripts/release-board/scan.js <base-dir> [rules.json]
//
// <base-dir> is the folder that holds the project folders named in the rules file
// (each project's "path" is relative to it). Prints the open-state counts per project,
// the first-scan time and the second (cached) scan time.

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("../../extension/node_modules/esbuild");

const base = process.argv[2];
if (!base) {
  console.error("usage: node scripts/release-board/scan.js <base-dir> [rules.json]");
  process.exit(1);
}
const rules = process.argv[3] || path.join(__dirname, "saropa_board_rules.json");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "board-")), "scan.js");
const entry = path.join(__dirname, "..", "..", "extension", "src", "board");
esbuild.buildSync({
  stdin: {
    contents: `
      import { scanAll } from "./scanner";
      import { nodeFileSource } from "./nodeSource";
      export { scanAll, nodeFileSource };`,
    resolveDir: entry,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: out,
});
const { scanAll, nodeFileSource } = require(out);
(async () => {
  const cfg = JSON.parse(fs.readFileSync(rules, "utf8"));
  const source = nodeFileSource(base);
  let t = Date.now();
  const first = await scanAll(cfg, source);
  console.log(`first scan ${Date.now() - t} ms`);
  for (const [id, p] of Object.entries(first.snapshot.projects)) {
    const c = p.counts;
    console.log(id, `red ${c.red} amber ${c.amber} purple ${c.purple} grey ${c.grey}`);
  }
  t = Date.now();
  await scanAll(cfg, source, first.snapshot);
  console.log(`second scan (cached) ${Date.now() - t} ms`);
})();

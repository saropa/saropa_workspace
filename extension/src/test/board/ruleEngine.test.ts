// Release Board rule engine: glob semantics, rule order, Status line, and a golden
// test over a frozen copy of the three Saropa repos' file lists (fixtures/). The
// fixture is what runs in CI; the live repos live outside this repo and change with
// every commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { globToRegExp } from "../../board/glob";
import { classifyFile, compileProject, findStatusWord } from "../../board/ruleEngine";
import { scanAll, FileSource } from "../../board/scanner";
import { BoardConfig, ScanFile, StatusCounts, emptyCounts } from "../../board/types";

const fixtures = path.join(__dirname, "..", "..", "..", "src", "test", "board", "fixtures");

function loadConfig(): BoardConfig {
  return JSON.parse(fs.readFileSync(path.join(fixtures, "saropaRules.json"), "utf8"));
}

test("glob: braces, globstar and single segment", () => {
  assert.ok(globToRegExp("**/{history,done}/**").test("docs/history/a.md"));
  assert.ok(globToRegExp("**/{history,done}/**").test("done/a.md"));
  assert.ok(!globToRegExp("**/{history,done}/**").test("docs/historyx/a.md"));
  assert.ok(globToRegExp("bugs/*.md").test("bugs/A.md"));
  assert.ok(!globToRegExp("bugs/*.md").test("bugs/human/A.md"));
  assert.ok(globToRegExp("{BUG_}*").test("BUG_x.md"));
  assert.ok(globToRegExp("a?.md").test("ab.md"));
  assert.ok(!globToRegExp("a.md").test("axmd"));
});

test("status line: word is lower-cased and stripped", () => {
  assert.equal(findStatusWord("# Title\n\n**Status:** WIP\n"), "wip");
  assert.equal(findStatusWord("Status: Done."), "done");
  assert.equal(findStatusWord("# no status here"), undefined);
});

function config(): BoardConfig {
  return {
    version: 1,
    ignore: [],
    ruleSets: {
      s: {
        params: { done: ["history"] },
        rules: [
          { id: "done", when: { path: "**/{$done}/**" }, set: { status: "green" } },
          { id: "live", when: { path: "bugs/*.md" }, set: { status: "red", kind: "bug" } },
        ],
        statusLine: { appliesTo: ["red"], words: { fixed: "green" } },
      },
    },
    projects: [
      {
        id: "p",
        path: "p",
        roots: ["bugs"],
        ruleSets: ["s"],
        rules: [{ id: "mine", when: { name: "MINE_*" }, set: { status: "purple" } }],
      },
    ],
  };
}

test("project rules run before rule set rules; first match wins", () => {
  const cfg = config();
  const cp = compileProject(cfg, cfg.projects[0]);
  const f = (p: string): ScanFile => ({ path: p, size: 1, mtimeMs: 1 });
  assert.equal(classifyFile(cp, f("bugs/MINE_a.md"), undefined).status, "purple");
  assert.equal(classifyFile(cp, f("bugs/a.md"), undefined).rule, "live");
  assert.equal(classifyFile(cp, f("bugs/history/a.md"), undefined).status, "green");
  assert.equal(classifyFile(cp, f("elsewhere/a.md"), undefined).status, "grey");
});

test("status line moves a live item only when the state allows it", () => {
  const cfg = config();
  const cp = compileProject(cfg, cfg.projects[0]);
  const live = classifyFile(cp, { path: "bugs/a.md", size: 1, mtimeMs: 1 }, "fixed");
  assert.equal(live.status, "green");
  assert.equal(live.rule, "live > status line");
  const purple = classifyFile(cp, { path: "bugs/MINE_a.md", size: 1, mtimeMs: 1 }, "fixed");
  assert.equal(purple.status, "purple", "appliesTo does not include purple");
});

// The frozen fixture: one line per file, tab separated:
// project, path, status word, expected status, expected kind, expected rule, rule set.
interface FixtureRow {
  project: string;
  path: string;
  word: string;
  status: string;
  kind: string;
  rule: string;
  ruleSet: string;
}

function loadFixture(): FixtureRow[] {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(fixtures, "saropaRepos.tsv.gz"))).toString("utf8");
  return text.split("\n").map((l) => {
    const [project, p, word, status, kind, rule, ruleSet] = l.split("\t");
    return { project, path: p, word, status, kind, rule, ruleSet };
  });
}

function fixtureSource(rows: FixtureRow[], cfg: BoardConfig): FileSource {
  const byProject = new Map<string, FixtureRow[]>();
  for (const r of rows) {
    const k = cfg.projects.find((p) => p.id === r.project)!.path;
    (byProject.get(k) ?? byProject.set(k, []).get(k)!).push(r);
  }
  return {
    async list(projectDir: string, root: string): Promise<ScanFile[]> {
      return (byProject.get(projectDir) ?? [])
        .filter((r) => r.path.startsWith(root + "/"))
        .map((r) => ({ path: r.path, size: r.path.length, mtimeMs: 1 }));
    },
    async readHead(projectDir: string, p: string): Promise<string> {
      const r = (byProject.get(projectDir) ?? []).find((x) => x.path === p);
      return r && r.word ? "Status: " + r.word : "";
    },
  };
}

test("golden: TypeScript engine matches the prototype on the frozen Saropa repos", async () => {
  const cfg = loadConfig();
  cfg.projects = cfg.projects.filter((p) => ["app", "supabase", "web"].includes(p.id));
  const rows = loadFixture();
  const result = await scanAll(cfg, fixtureSource(rows, cfg));
  const expected = new Map(rows.map((r) => [r.project + "\t" + r.path, r]));
  assert.equal(result.rows.length, rows.length, "same file count");
  let mismatches = 0;
  for (const got of result.rows) {
    const want = expected.get(got.project + "\t" + got.path)!;
    if (got.status !== want.status || got.kind !== want.kind || (got.rule ?? "") !== want.rule) {
      mismatches += 1;
    }
  }
  assert.equal(mismatches, 0, "every file has the prototype's state, kind and rule");

  const c = (id: string): StatusCounts => result.snapshot.projects[id].counts;
  const pick = (id: string, keys: Array<keyof StatusCounts>): Partial<StatusCounts> =>
    Object.fromEntries(keys.map((k) => [k, c(id)[k]]));
  assert.deepEqual(pick("app", ["red", "amber", "grey"]), { red: 10, amber: 53, grey: 4 });
  assert.deepEqual(pick("supabase", ["red", "amber", "grey"]), { red: 6, amber: 3, grey: 8 });
  assert.deepEqual(pick("web", ["red", "amber"]), { red: 2, amber: 26 });
  assert.notDeepEqual(c("app"), emptyCounts());
});

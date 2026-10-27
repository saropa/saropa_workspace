// Live evidence host side: settings, which project owns a file, which files are asked
// about, and the whole gather against a temp project and a fake Problems panel.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { BoardItem } from "../../board/boardModel";
import { BoardConfig } from "../../board/types";
import { BoardRun } from "../../commands/boardScanStore";
import { erroringFiles, filesToAsk, liveFold, loadLiveSignals, namedFiles, owner, problemCounts, readLiveSettings } from "../../commands/boardLive";
import { stub, tmpDir } from "./hostHelpers";

const SECTION = "saropaWorkspace.releaseBoard.liveEvidence";
const ERROR = 0;
const WARNING = 1;

afterEach(() => {
  stub.__resetConfig();
  stub.__setDiagnostics([]);
});

function item(project: string, p: string): BoardItem {
  return { id: 0, project, path: p, title: p, status: "red", kind: "", hub: false, waitsOn: [], blocksCount: 0, pinned: false, stopping: true };
}

function runFor(root: string, sourceFiles: string[]): BoardRun {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", path: root, roots: [], ruleSets: [] }], sourceDirs: ["src"] };
  const facts = { "docs/bug.md": { facts: { sourceFiles } } };
  return { cfg, result: { snapshot: { projects: { app: { facts } } } } } as unknown as BoardRun;
}

test("settings: on by default, the board switch turns everything off, days are clamped", () => {
  assert.deepEqual(readLiveSettings(), { enabled: true, includeWarnings: true, lookbackDays: 1, unnamedBox: true });
  stub.__setConfig(SECTION, "lookbackDays", 9999);
  assert.ok(readLiveSettings().lookbackDays < 9999);
  stub.__setConfig("saropaWorkspace.releaseBoard", "enabled", false);
  assert.equal(readLiveSettings().enabled, false);
});

test("problem counts split errors and warnings, and nothing to count is undefined", () => {
  const d = (severity: number): vscode.Diagnostic => ({ severity }) as vscode.Diagnostic;
  assert.deepEqual(problemCounts([d(ERROR), d(WARNING), d(ERROR), d(2)]), { errors: 2, warnings: 1 });
  assert.equal(problemCounts([d(2), d(3)]), undefined);
  assert.equal(problemCounts(undefined), undefined);
});

test("a file belongs to the deepest project that holds it", () => {
  const projects = [
    { id: "outer", root: vscode.Uri.parse("file:///work/app") },
    { id: "inner", root: vscode.Uri.parse("file:///work/app/packages/ui") },
  ];
  const pick = (uri: string): { id?: string; rel?: string } => ({ id: owner(projects, vscode.Uri.parse(uri))?.id, rel: owner(projects, vscode.Uri.parse(uri))?.rel });
  assert.deepEqual(pick("file:///work/app/packages/ui/src/a.ts"), { id: "inner", rel: "src/a.ts" });
  assert.deepEqual(pick("file:///work/app/src/b.ts"), { id: "outer", rel: "src/b.ts" });
  assert.equal(owner(projects, vscode.Uri.parse("file:///elsewhere/c.ts")), undefined);
});

test("files with an error are listed per project, and warnings or other schemes are not", () => {
  const projects = [{ id: "app", root: vscode.Uri.parse("file:///work/app") }];
  const err = { severity: ERROR } as vscode.Diagnostic;
  const warn = { severity: WARNING } as vscode.Diagnostic;
  const all: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
    [vscode.Uri.parse("file:///work/app/src/a.ts"), [err]],
    [vscode.Uri.parse("file:///work/app/src/b.ts"), [warn]],
    [vscode.Uri.parse("untitled://work/app/src/c.ts"), [err]],
  ];
  assert.deepEqual([...erroringFiles(all, projects)], [["app", ["src/a.ts"]]]);
});

test("named files come from the project's own open documents only", () => {
  const run = runFor("/work/app", ["src/a.ts", "src/b.ts"]);
  const named = namedFiles(run, [item("app", "docs/bug.md"), item("other", "docs/bug.md")], "app");
  assert.deepEqual([...named.values()].sort(), ["src/a.ts", "src/b.ts"]);
  assert.equal(namedFiles(run, [item("other", "docs/bug.md")], "app").size, 0);
});

test("files to ask: named first, then nameable error files, no repeats, capped", () => {
  const named = new Map([["src/a.ts", "src/a.ts"]]);
  const files = filesToAsk(named, ["src/a.ts", "src/b.ts"], ["src/c.ts", "node_modules/x.js"], ["src"]);
  assert.equal(files[0], "src/a.ts");
  assert.ok(files.includes("src/b.ts") && files.includes("src/c.ts"));
  assert.equal(files.filter((f) => f === "src/a.ts").length, 1);
  assert.ok(!files.includes("node_modules/x.js"));
  const many = Array.from({ length: 500 }, (_, i) => `src/f${i}.ts`);
  assert.equal(filesToAsk(new Map(), many, [], ["src"]).length, 300);
  assert.equal(typeof liveFold, "boolean");
});

test("the gather puts Problems counts on the files a document names", async () => {
  const root = tmpDir();
  const a = vscode.Uri.file(`${root}/src/a.ts`);
  stub.__setDiagnostics([[a, [{ severity: ERROR }, { severity: WARNING }]]]);
  const live = await loadLiveSignals(runFor(root, ["src/a.ts"]), [item("app", "docs/bug.md")], readLiveSettings());
  assert.deepEqual(live.app["src/a.ts"].problems, { errors: 1, warnings: 1 });
});

test("a document that names no file gets no signals, and a failing read gives an empty result", async () => {
  const root = tmpDir();
  assert.deepEqual(await loadLiveSignals(runFor(root, []), [item("app", "docs/bug.md")], readLiveSettings()), {});
  const broken = { cfg: { projects: [{ id: "app", path: root }] }, result: null } as unknown as BoardRun;
  assert.deepEqual(await loadLiveSignals(broken, [item("app", "docs/bug.md")], readLiveSettings()), {});
});

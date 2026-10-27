// Path to GO: one step per cause of a light that is not GO, in a fixed order, and never
// disagreeing with the light: no steps if and only if GO.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as vm from "node:vm";
import { BoardModel, BoardProject, buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { ProjectHealth, evaluateHealth } from "../../board/health";
import { PathOptions, PathToGo, clampMaxSteps, pathToGo } from "../../board/pathToGo";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";

const DAY = 86400000;
const NOW = 100 * DAY;
const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [
    { id: "app", name: "App", path: "app", roots: [], ruleSets: [], importance: "high" },
    { id: "db", name: "Db", path: "db", roots: [], ruleSets: [] },
  ],
};
const opts: PathOptions = { maxSteps: 20, canRun: () => true };

function row(project: string, path: string, status: BoardStatus, extra: Partial<Classified> = {}): Classified {
  return { project, path, status, kind: "", note: "", ...extra };
}

const run = { name: "t", outcome: "success" as const, exitCode: 0, endedAt: NOW - DAY, run: 5, failed: 0 };
const goodHealth = evaluateHealth({ lintApplies: false }, { tests: run }, undefined, NOW);
const noHealth = evaluateHealth(undefined, undefined, undefined, NOW);
const failLint = evaluateHealth({ testsApply: false }, { lint: { name: "l", outcome: "failure", exitCode: 1, endedAt: NOW - DAY } }, undefined, NOW);
const failTests = evaluateHealth({ lintApplies: false }, { tests: { ...run, outcome: "failure", exitCode: 1, failed: 2 } }, undefined, NOW);

function board(rows: Classified[], accepted: boolean, health: Record<string, ProjectHealth>, pins: string[] = []): BoardModel {
  return buildBoard(cfg, rows, undefined, accepted, undefined, undefined, health, { pins });
}

function pathOf(m: BoardModel, id = "app", o: PathOptions = opts): PathToGo {
  return pathToGo(m, m.projects.find((p) => p.id === id)!, o);
}

const kinds = (p: PathToGo): string[] => p.steps.map((s) => s.kind);

test("an empty path is GO, and GO is an empty path", () => {
  const go = board([], true, { app: goodHealth, db: goodHealth });
  assert.equal(go.projects[0].light, "go");
  assert.deepEqual(pathOf(go).steps, []);
  assert.equal(pathOf(go).hidden, 0);
});

test("the path agrees with the light across every combination of causes", () => {
  const healths: Array<[string, ProjectHealth | undefined]> = [["good", goodHealth], ["none", undefined], ["missing", noHealth], ["lint-fail", failLint], ["tests-fail", failTests]];
  const docs: Array<[string, Classified[], string[]]> = [
    ["none", [], []],
    ["red", [row("app", "bugs/A.md", "red")], []],
    ["pinned amber", [row("app", "docs/B.md", "amber")], ["app/docs/B.md"]],
    ["plain amber", [row("app", "docs/B.md", "amber")], []],
    ["blocked amber pinned", [row("app", "docs/blocked/C.md", "amber", { note: "blocked" })], ["app/docs/blocked/C.md"]],
    ["grey", [row("app", "docs/G.md", "grey")], []],
    ["purple", [row("app", "bugs/P.md", "purple")], []],
  ];
  let seenGo = 0;
  for (const accepted of [true, false]) {
    for (const [hn, h] of healths) {
      for (const [dn, rows, pins] of docs) {
        const m = board(rows, accepted, h ? { app: h } : {}, pins);
        for (const p of m.projects) {
          const path = pathToGo(m, p, opts);
          const label = `${p.id} accepted=${accepted} health=${hn} docs=${dn} light=${p.light}`;
          assert.equal(path.steps.length === 0, p.light === "go", label);
          if (p.light === "go") {
            seenGo += 1;
          } else {
            assert.ok(path.steps.length > 0, label);
          }
          assert.equal(path.allKeys.length, path.steps.length + path.hidden, label);
        }
      }
    }
  }
  assert.ok(seenGo > 0, "the table reaches GO");
});

test("each reason has its own step: evidence, rules, unread, accept", () => {
  const m = board([row("app", "docs/G.md", "grey"), row("app", "a/b/c.md", "amber")], false, {});
  m.needsRule = [{ project: "app", folder: "docs", count: 1 }, { project: "db", folder: "other", count: 4 }];
  const p = pathOf(m);
  assert.deepEqual(kinds(p), ["lint", "tests", "rules", "unread", "accept"]);
  assert.equal(p.steps[2].folder, "docs");
  assert.equal(p.steps[2].count, 1);
  assert.equal(p.steps[3].count, 1);
  m.needsRule = [];
  assert.equal(pathOf(m).steps[2].folder, undefined, "no folder list: one step for the project");
});

test("failing evidence is named as failing, missing as missing", () => {
  assert.equal(pathOf(board([], true, { app: failLint })).steps[0].evidence, "failing");
  const t = pathOf(board([], true, { app: failTests })).steps;
  assert.deepEqual(t.map((s) => [s.kind, s.evidence]), [["tests", "failing"]]);
  const missing = pathOf(board([], true, { app: noHealth })).steps;
  assert.deepEqual(missing.map((s) => [s.kind, s.evidence]), [["lint", "missing"], ["tests", "missing"]]);
});

test("run buttons need a shortcut the project names", () => {
  const m = board([], true, { app: noHealth });
  assert.deepEqual(pathOf(m, "app", { maxSteps: 8, canRun: (k) => k === "lint" }).steps.map((s) => s.run), [true, false]);
  assert.deepEqual(pathOf(m, "app", { maxSteps: 8, canRun: () => false }).steps.map((s) => s.run), [false, false]);
});

test("order: most waiting documents freed first, then red, then severity; evidence after", () => {
  const rows = [row("app", "bugs/A.md", "red"), row("app", "bugs/B.md", "red"), row("app", "docs/C.md", "amber")];
  const m = board(rows, true, { app: noHealth }, ["app/docs/C.md"]);
  const byTitle = (t: string) => m.items.find((i) => i.title === t)!;
  byTitle("B").blocksCount = 3;
  const p = pathOf(m);
  assert.deepEqual(p.steps.map((s) => s.title ?? s.kind), ["B", "A", "C", "lint", "tests", "unread"]);
  assert.equal(p.steps[0].unblocks, 3);
  assert.deepEqual(p.steps.slice(0, 3).map((s) => s.why), ["red", "red", "pinned"]);
});

function waits(m: BoardModel, from: string, ...to: string[]): void {
  const id = (t: string): number => m.items.find((i) => i.title === t)!.id;
  m.items[id(from)].waitsOn = to.map(id);
}

test("a stopper is acted on through its own prerequisites, once", () => {
  const rows = [row("app", "bugs/FIRST.md", "red"), row("app", "bugs/SECOND.md", "red"), row("app", "bugs/THIRD.md", "red")];
  const m = board(rows, true, { app: goodHealth });
  waits(m, "SECOND", "FIRST");
  waits(m, "THIRD", "SECOND");
  const items = pathOf(m).steps.filter((x) => x.kind === "item");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "FIRST");
  assert.equal(items[0].waiter, "SECOND");
});

test("two unrelated stoppers in one group stay two steps", () => {
  // ROOT is waited on by LEFT and RIGHT's chain; LEFT and RIGHT do not wait on each other.
  const rows = ["ROOT", "LEFT", "RIGHT", "BASE"].map((n) => row("app", `bugs/${n}.md`, "red"));
  const m = board(rows, true, { app: goodHealth });
  waits(m, "LEFT", "ROOT");
  waits(m, "RIGHT", "BASE");
  m.chains = [m.items.map((i) => ({ project: "App", title: i.title, path: i.path, id: i.id, done: false }))];
  const titles = pathOf(m).steps.filter((x) => x.kind === "item").map((x) => x.title).sort();
  assert.deepEqual(titles, ["BASE", "ROOT"], "each stopper is cleared through its own prerequisite");
});

test("a prerequisite loop does not hang", () => {
  const m = board([row("app", "bugs/A.md", "red"), row("app", "bugs/B.md", "red")], true, { app: goodHealth });
  waits(m, "A", "B");
  waits(m, "B", "A");
  const n = pathOf(m).steps.filter((x) => x.kind === "item").length;
  assert.ok(n >= 1 && n <= 2, "ends, and names a document");
});

test("a head that does not stop the release is worded by the document that waits on it", () => {
  const m = board([row("app", "docs/LOW.md", "amber"), row("app", "bugs/RED.md", "red")], true, { app: goodHealth });
  waits(m, "RED", "LOW");
  const step = pathOf(m).steps.find((x) => x.kind === "item")!;
  assert.equal(step.title, "LOW");
  assert.equal(step.why, undefined);
  assert.equal(step.severity, undefined);
  assert.equal(step.waiter, "RED");
  const html = renderBoard(m, t, "N", 1, {}, m.projects.map((p) => pathToGo(m, p, opts)));
  assert.ok(html.includes("[ptgItemFirst]"));
  assert.ok(!html.includes("[ptgItemRed]") || m.items.length > 1);
});

test("item keys follow the document path, and carry no path", () => {
  const m = board([row("app", "bugs/X.md", "red")], true, { app: goodHealth });
  const m2 = board([row("app", "docs/X.md", "red")], true, { app: goodHealth });
  const k = pathOf(m).steps[0].key;
  assert.notEqual(k, pathOf(m2).steps[0].key, "same title in another folder is another step");
  assert.ok(!k.includes("bugs") && !k.includes(".md"));
  assert.equal(k, pathOf(board([row("app", "bugs/X.md", "red")], true, { app: goodHealth })).steps[0].key, "stable");
});

test("the one-step and per-folder rules forms share a key", () => {
  const m = board([row("app", "docs/G.md", "grey")], true, { app: goodHealth });
  m.needsRule = [{ project: "app", folder: "docs", count: 1 }];
  assert.ok(pathOf(m).allKeys.includes("rules:"));
  m.needsRule = [];
  assert.deepEqual(pathOf(m).allKeys, ["rules:"]);
});

test("html: a stale or loading paint has no buttons and is not live; the profile is kept for the page memory", () => {
  const m = board([row("app", "bugs/A.md", "red")], false, {});
  const paths = m.projects.map((p) => pathToGo(m, p, opts));
  const live = renderBoard(m, t, "N", 1, {}, paths);
  assert.ok(live.includes('data-live="1"') && live.includes("ptgb"));
  assert.ok(live.includes('const PROFILE="deliberate"'));
  for (const state of [{ stale: true }, { loading: true }]) {
    const html = renderBoard(m, t, "N", 1, state, paths);
    assert.ok(html.includes('data-live="0"'));
    assert.ok(!html.includes('class="ptgb"'), "no step buttons while the board cannot act");
  }
  const ev = board([], true, { app: noHealth });
  const evHtml = renderBoard(ev, t, "N", 1, {}, ev.projects.map((p) => pathToGo(ev, p, opts)));
  assert.ok(/class="ptgb" data-p="0" data-s="0" data-run="1"/.test(evHtml), "run buttons are marked so the page can disable them");
});

test("collapsed blocked documents that would stop the release have their own step", () => {
  const m = board([], true, { app: goodHealth });
  const p = pathToGo(m, { ...m.projects[0], blockedStopping: 2 }, opts);
  assert.deepEqual(p.steps.map((x) => [x.kind, x.count]), [["blocked", 2]]);
});

test("the step limit cuts the list and counts what is left; allKeys keeps every step", () => {
  const rows: Classified[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push(row("app", `bugs/R${i}.md`, "red"));
  }
  const m = board(rows, true, { app: goodHealth });
  const p = pathOf(m, "app", { maxSteps: 5, canRun: () => false });
  assert.equal(p.steps.length, 5);
  assert.equal(p.hidden, 8, "12 documents and the unread step");
  assert.equal(p.allKeys.length, 13);
  assert.equal(pathOf(m, "app", { maxSteps: 1, canRun: () => false }).steps.length, 3, "never fewer than 3");
});

test("the step limit is kept between 3 and 20", () => {
  assert.equal(clampMaxSteps(1), 3);
  assert.equal(clampMaxSteps(99), 20);
  assert.equal(clampMaxSteps(8), 8);
  assert.equal(clampMaxSteps("x"), 8);
  assert.equal(clampMaxSteps(NaN), 8);
});

const t: BoardStrings = new Proxy({} as BoardStrings, { get: (_o, k: string) => `[${k}] {title} {count}` });

test("html: steps are escaped, the page carries indexes and no paths, and no paths means no lists", () => {
  const m = board([row("app", "bugs/<script>alert(1)</script>.md", "red")], false, {});
  const paths = m.projects.map((p) => pathToGo(m, p, opts));
  const html = renderBoard(m, t, "N", 3, {}, paths);
  assert.ok(html.includes('class="pj"'));
  assert.ok(html.includes('data-p="0" data-s="0"'));
  assert.ok(!html.includes("<script>alert"), "title is escaped");
  assert.ok(!html.includes('data-path'), "no path attribute");
  const plain = renderBoard(m, t, "N", 3, {});
  assert.ok(!plain.includes('class="pj"'));
  const buttons = html.match(/class="ptgb"[^>]*>/g) ?? [];
  assert.ok(buttons.every((b) => /data-p="\d+" data-s="\d+"/.test(b)));
});

test("html: a GO project shows the nothing-left line", () => {
  const m = board([], true, { app: goodHealth, db: goodHealth });
  const html = renderBoard(m, t, "N", 1, {}, m.projects.map((p) => pathToGo(m, p, opts)));
  assert.ok(html.includes("[ptgNone]"));
});

test("projects keep the order the paths were built in", () => {
  const m = board([row("db", "bugs/D.md", "red")], true, {});
  const idx = m.projects.map((p: BoardProject) => p.id);
  assert.deepEqual(idx, ["app", "db"]);
  assert.deepEqual(kinds(pathOf(m, "db")).slice(0, 1), ["item"]);
});

test("html: the page script is valid", () => {
  const m = board([row("app", "bugs/A.md", "red")], true, {});
  const html = renderBoard(m, t, "N", 1, {}, m.projects.map((p) => pathToGo(m, p, opts)));
  const code = /<script nonce="N">([\s\S]*)<\/script>/.exec(html)![1];
  assert.doesNotThrow(() => new vm.Script(code));
});

// Unit tests for the Code Health score read from the Saropa Lints extension API.
// The extension is faked through vscode.extensions; the score math runs for real.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { showLintsHealthScore } from "../exec/lintsHealth";

type Api = {
  getViolationsData(): unknown;
  getHealthScoreParams(): unknown;
  runAnalysis(): Promise<boolean>;
};

const win = vscode.window as unknown as Record<string, unknown>;
const exts = vscode.extensions as unknown as Record<string, unknown>;
const cmds = vscode.commands as unknown as Record<string, unknown>;
let origInfo: unknown;
let origGet: unknown;
let origExec: unknown;
let infos: string[];
let executed: string[];
let answer: "open" | undefined;

beforeEach(() => {
  origInfo = win.showInformationMessage;
  origGet = exts.getExtension;
  origExec = cmds.executeCommand;
  infos = [];
  executed = [];
  answer = undefined;
  win.showInformationMessage = (m: string, ...items: string[]): Promise<string | undefined> => {
    infos.push(m);
    return Promise.resolve(answer === "open" ? items[0] : undefined);
  };
  cmds.executeCommand = (c: string): Promise<undefined> => {
    executed.push(c);
    return Promise.resolve(undefined);
  };
});

afterEach(() => {
  win.showInformationMessage = origInfo;
  exts.getExtension = origGet;
  cmds.executeCommand = origExec;
});

function install(api: Partial<Api> | undefined, active = true): void {
  exts.getExtension = (): unknown =>
    api === undefined
      ? undefined
      : { isActive: active, exports: api, activate: async () => api };
}

const params = { impactWeights: { error: 8, warning: 3, info: 0.25 }, decayRate: 0.1 };

function withData(summary: Record<string, unknown>, p: unknown = params): Partial<Api> {
  return { getViolationsData: () => ({ summary }), getHealthScoreParams: () => p };
}

test("reports that Saropa Lints is missing when the extension is absent", async () => {
  install(undefined);
  await showLintsHealthScore();
  assert.equal(infos.length, 1);
  assert.match(infos[0], /not installed/);
});

test("computes a score from weighted violation density", async () => {
  // 1 error, 2 warnings over 10 files: weighted 8 + 6 = 14, density 1.4, exp(-0.14) -> 87.
  install(withData({ filesAnalyzed: 10, byImpact: { error: 1, warning: 2, info: 0 } }));
  await showLintsHealthScore();
  assert.match(infos[0], /Code Health 87\/100 - good shape\. 1 error\(s\), 2 warning\(s\), 0 info across 10 file\(s\)\./);
});

test("a clean sweep scores 100", async () => {
  install(withData({ filesAnalyzed: 5, byImpact: {} }));
  await showLintsHealthScore();
  assert.match(infos[0], /Code Health 100\/100 - good shape/);
});

test("score bands: fair from 50 and poor below", async () => {
  // density 6 -> exp(-0.6)=0.549 -> 55 (fair).
  install(withData({ filesAnalyzed: 1, byImpact: { warning: 2 } }));
  await showLintsHealthScore();
  assert.match(infos[0], /55\/100 - needs work/);
  infos.length = 0;
  // density 40 -> exp(-4) -> 2 (poor).
  install(withData({ filesAnalyzed: 1, byImpact: { error: 5 } }));
  await showLintsHealthScore();
  assert.match(infos[0], /2\/100 - serious problems/);
});

test("bySeverity is used when byImpact is absent", async () => {
  install(withData({ filesAnalyzed: 1, bySeverity: { error: 5 } }));
  await showLintsHealthScore();
  assert.match(infos[0], /5 error\(s\)/);
});

test("non-numeric counts are treated as zero", async () => {
  install(withData({ filesAnalyzed: 2, byImpact: { error: "many", warning: NaN } }));
  await showLintsHealthScore();
  assert.match(infos[0], /100\/100 .* 0 error\(s\), 0 warning\(s\)/);
});

test("missing impact weights fall back to the defaults", async () => {
  // Default error weight 8: density 8 * decay 0.1 -> exp(-0.8) -> 45.
  install(withData({ filesAnalyzed: 1, byImpact: { error: 1 } }, { impactWeights: {}, decayRate: 0.1 }));
  await showLintsHealthScore();
  assert.match(infos[0], /45\/100 - serious problems/);
});

test("a partial analysis (under 15% coverage) gives no score", async () => {
  install(withData({ filesAnalyzed: 1, filesExpected: 100, byImpact: { error: 1 } }));
  await showLintsHealthScore();
  assert.match(infos[0], /not a full enough sweep/);
});

test("exactly 15% coverage is enough to score", async () => {
  install(withData({ filesAnalyzed: 15, filesExpected: 100, byImpact: {} }));
  await showLintsHealthScore();
  assert.match(infos[0], /Code Health 100/);
});

test("zero analyzed files or a missing summary gives no score", async () => {
  install(withData({ filesAnalyzed: 0 }));
  await showLintsHealthScore();
  assert.match(infos[0], /not a full enough sweep/);
  infos.length = 0;
  install({ getViolationsData: () => ({}), getHealthScoreParams: () => params });
  await showLintsHealthScore();
  assert.match(infos[0], /not a full enough sweep/);
});

test("with no data it offers to run an analysis and stops if declined", async () => {
  let ran = 0;
  install({ getViolationsData: () => null, getHealthScoreParams: () => null, runAnalysis: async () => (ran++, true) });
  await showLintsHealthScore();
  assert.match(infos[0], /no analysis data yet/);
  assert.equal(ran, 0);
});

test("choosing the dashboard button opens the Code Health report", async () => {
  answer = "open";
  install(withData({ filesAnalyzed: 3, byImpact: {} }));
  await showLintsHealthScore();
  assert.deepEqual(executed, ["saropaLints.openProjectVibrancyReport"]);
});

test("a failing dashboard command is swallowed", async () => {
  answer = "open";
  cmds.executeCommand = (): Promise<never> => Promise.reject(new Error("missing"));
  install(withData({ filesAnalyzed: 3, byImpact: {} }));
  await assert.doesNotReject(showLintsHealthScore());
});

test("an inactive extension is activated before use", async () => {
  let activated = 0;
  const api = withData({ filesAnalyzed: 2, byImpact: {} });
  exts.getExtension = (): unknown => ({ isActive: false, exports: undefined, activate: async () => (activated++, api) });
  await showLintsHealthScore();
  assert.equal(activated, 1);
  assert.match(infos[0], /Code Health 100/);
});

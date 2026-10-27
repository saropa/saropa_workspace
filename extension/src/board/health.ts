// Code health for the board: lint and test evidence. Pure; the VS Code layer supplies the
// recorded shortcut runs and the text of the Saropa Lints file. Evidence is never assumed:
// a result that is stale, partial, from a run with no exit code, or absent counts as
// missing, and a missing result keeps the light at UNVERIFIED.

export interface HealthConfig {
  // Shortcuts (id or name) whose background run is the project's test run, and its lint run.
  tests?: string[];
  lint?: string[];
  // Saropa Lints violations file, relative to the project. Used when it exists.
  lintFile?: string;
  // False for a project with no tests (documentation only, database scripts) or no lint.
  testsApply?: boolean;
  lintApplies?: boolean;
  // A result older than this many days counts as missing. Default 7.
  staleDays?: number;
}

export const DEFAULT_LINT_FILE = "reports/.saropa_lints/violations.json";
const DEFAULT_STALE_DAYS = 7;
// Below this share of expected files analyzed, a lint file is a partial sweep (the same
// gate the Workspace's Lints health score uses).
const MIN_COVERAGE = 0.15;

// One recorded background run of a configured shortcut.
export interface RunRecord {
  // Shortcut that produced the run; a record whose shortcut is no longer configured is ignored.
  pinId?: string;
  name: string;
  outcome: "success" | "failure";
  exitCode: number | null;
  endedAt: number;
  // Tally parsed from the run's output, when it had a recognised summary line.
  run?: number;
  failed?: number;
}

export interface RecordedRuns {
  tests?: RunRecord;
  lint?: RunRecord;
}

export interface HealthFile {
  version: 1;
  projects: Record<string, RecordedRuns>;
  // Last run time handled per shortcut id, so a run is recorded once.
  seen: Record<string, number>;
}

export interface LintResult {
  errors: number;
  warnings: number;
  info: number;
  takenAt: number;
}

export type LintRead = { ok: true; result: LintResult } | { ok: false; why: "unreadable" | "empty" | "partial" };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function stamp(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

// Reads a Saropa Lints violations file. The time is the file's own timestamp when it has
// one, else the file's modified time.
export function parseLintsFile(text: string, mtimeMs: number): LintRead {
  let data: { summary?: Record<string, unknown>; timestamp?: unknown; generatedAt?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, why: "unreadable" };
  }
  const s = data?.summary;
  if (!s || typeof s !== "object") {
    return { ok: false, why: "unreadable" };
  }
  const analyzed = num(s.filesAnalyzed);
  if (analyzed === 0) {
    return { ok: false, why: "empty" };
  }
  const expected = num(s.filesExpected);
  if (expected > 0 && analyzed < expected * MIN_COVERAGE) {
    return { ok: false, why: "partial" };
  }
  const counts = ((s.byImpact ?? s.bySeverity ?? {}) as Record<string, unknown>) ?? {};
  // Without an error count the file says nothing about errors: not a pass.
  if (typeof counts.error !== "number") {
    return { ok: false, why: "unreadable" };
  }
  return {
    ok: true,
    result: {
      errors: num(counts.error),
      warnings: num(counts.warning),
      info: num(counts.info),
      takenAt: stamp(data.timestamp) ?? stamp(data.generatedAt) ?? stamp(s.timestamp) ?? mtimeMs,
    },
  };
}

// The number of tests run and failed, from the summary line of common runners. Undefined
// when the output has none: the board then knows only the exit code.
export function parseTestTally(output: string): { run: number; failed: number } | undefined {
  const text = output.replace(/\x1b\[[0-9;]*m/g, "");
  // node:test
  const nt = /^(?:# |ℹ )tests (\d+)[\s\S]*?^(?:# |ℹ )fail (\d+)/m.exec(text);
  if (nt) {
    return { run: Number(nt[1]), failed: Number(nt[2]) };
  }
  // Jest
  const jest = /^Tests:\s+(.*?)(\d+) total/m.exec(text);
  if (jest) {
    const failed = /(\d+) failed/.exec(jest[1]);
    const skipped = /(\d+) skipped/.exec(jest[1]);
    return { run: Number(jest[2]) - Number(skipped?.[1] ?? 0), failed: failed ? Number(failed[1]) : 0 };
  }
  // Dart and Flutter: the last "+N -M" progress line
  const dart = [...text.matchAll(/^(?:\d+:\d+ )?\+(\d+)(?: ~\d+)?(?: -(\d+))?: /gm)].pop();
  if (dart) {
    const failed = Number(dart[2] ?? 0);
    return { run: Number(dart[1]) + failed, failed };
  }
  // pytest
  const py = /^=+ (.*) in [\d.]+s/m.exec(text);
  if (py && /\b(?:passed|failed|errors?)\b/.test(py[1])) {
    const n = (w: string): number => Number(new RegExp(`(\\d+) ${w}`).exec(py[1])?.[1] ?? 0);
    const failed = n("failed") + n("errors?");
    return { run: failed + n("passed"), failed };
  }
  // mocha
  const passing = /(\d+) passing/.exec(text);
  if (passing) {
    const failing = /(\d+) failing/.exec(text);
    return { run: Number(passing[1]) + Number(failing?.[1] ?? 0), failed: Number(failing?.[1] ?? 0) };
  }
  return undefined;
}

export type Evidence = "failing" | "passing" | "missing" | "na";

export interface ProjectHealth {
  lint: Evidence;
  tests: Evidence;
  lintDetail: string;
  testsDetail: string;
  // True when both kinds of evidence are present and clean: the only way to GO.
  clean: boolean;
}

function ago(ms: number): string {
  const d = Math.floor(ms / 86400000);
  return d >= 1 ? `${d} d ago` : `${Math.max(1, Math.floor(ms / 3600000))} h ago`;
}

// The lint verdict: the Lints file and the lint shortcut's last run. The newer fresh one
// decides; a file dated in the future is not evidence.
function lintEvidence(cfg: HealthConfig | undefined, runs: RecordedRuns | undefined, lintFile: LintRead | undefined, now: number, staleMs: number): { lint: Evidence; lintDetail: string } {
  if (cfg?.lintApplies === false) {
    return { lint: "na", lintDetail: "No lint for this project" };
  }
  let lintDetail = "No trusted lint result";
  const cands: Array<{ at: number; e: Evidence; detail: string }> = [];
  if (lintFile?.ok) {
    const r = lintFile.result;
    if (r.takenAt > now + 86400000) {
      lintDetail = "Lints file is dated in the future";
    } else if (now - r.takenAt > staleMs) {
      lintDetail = `Lints file is stale (${ago(now - r.takenAt)})`;
    } else {
      cands.push({ at: r.takenAt, e: r.errors > 0 ? "failing" : "passing", detail: `${r.errors} errors, ${r.warnings} warnings, ${r.info} info (${ago(now - r.takenAt)})` });
    }
  } else if (lintFile && !lintFile.ok) {
    lintDetail = `Lints file not trusted: ${lintFile.why}`;
  }
  if (runs?.lint) {
    const r = runs.lint;
    if (now - r.endedAt > staleMs) {
      lintDetail = `Lint run is stale (${ago(now - r.endedAt)})`;
    } else {
      cands.push({ at: r.endedAt, e: r.outcome === "failure" ? "failing" : "passing", detail: `${r.name}: exit ${r.exitCode} (${ago(now - r.endedAt)})` });
    }
  }
  const newest = cands.sort((x, y) => y.at - x.at)[0];
  return newest ? { lint: newest.e, lintDetail: newest.detail } : { lint: "missing", lintDetail };
}

// The test verdict: the last recorded test run, if it is fresh and ran at least one test.
function testsEvidence(cfg: HealthConfig | undefined, runs: RecordedRuns | undefined, now: number, staleMs: number): { tests: Evidence; testsDetail: string } {
  if (cfg?.testsApply === false) {
    return { tests: "na", testsDetail: "No tests for this project" };
  }
  const r = runs?.tests;
  if (!r) {
    return { tests: "missing", testsDetail: "No test run recorded" };
  }
  if (now - r.endedAt > staleMs) {
    return { tests: "missing", testsDetail: `Test run is stale (${ago(now - r.endedAt)})` };
  }
  const tally = r.run !== undefined ? `${r.run} tests run, ${r.failed ?? 0} failed` : `exit code ${r.exitCode}`;
  // A run that ran no tests is no evidence (a filter that matched nothing).
  const tests: Evidence = r.outcome === "failure" || (r.failed ?? 0) > 0 ? "failing" : r.run === 0 ? "missing" : "passing";
  return { tests, testsDetail: `${r.name}: ${tally} (${ago(now - r.endedAt)})` };
}

// Weighs the lint and test evidence against the age limit. Only fresh, clean evidence of both kinds is clean.
export function evaluateHealth(cfg: HealthConfig | undefined, runs: RecordedRuns | undefined, lintFile: LintRead | undefined, now: number): ProjectHealth {
  const staleMs = (cfg?.staleDays ?? DEFAULT_STALE_DAYS) * 86400000;
  const { lint, lintDetail } = lintEvidence(cfg, runs, lintFile, now, staleMs);
  const { tests, testsDetail } = testsEvidence(cfg, runs, now, staleMs);
  const ok = (e: Evidence): boolean => e === "passing" || e === "na";
  return { lint, tests, lintDetail, testsDetail, clean: ok(lint) && ok(tests) };
}

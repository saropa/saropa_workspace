// Live evidence: marks on documents from the signals in the files they name. The marks are
// information only: no signal may change a light.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, Classified } from "../../board/types";
import { ProjectHealth } from "../../board/health";
import {
  LiveSignals,
  apiUsable,
  bugDocument,
  bugsFolderOf,
  clampLookbackDays,
  markFor,
  parseLintViolations,
  readApiSignals,
  unnamedFiles,
} from "../../board/liveEvidence";

const opt = { includeWarnings: true, fold: false };
const signals: LiveSignals = {
  app: {
    "lib/a.dart": { problems: { errors: 1, warnings: 2 }, lints: { errors: 0, warnings: 3 }, logs: { errors: 3, warnings: 0, crashes: 1 } },
    "lib/b.dart": { lints: { errors: 0, warnings: 1 } },
    "lib/c.dart": {},
  },
};

test("a document gets a mark from the files it names, worst file first", () => {
  const m = markFor("app", ["lib/b.dart", "lib/a.dart", "lib/c.dart", "lib/none.dart"], signals, opt);
  assert.ok(m);
  assert.equal(m.hot, true);
  assert.deepEqual(m.files.map((f) => f.file), ["lib/a.dart", "lib/b.dart"]);
  assert.equal(m.crashes, 1);
  assert.equal(m.errors, 4);
  assert.equal(m.warnings, 6);
});

test("clean and quiet files give no mark; other projects are not mixed in", () => {
  assert.equal(markFor("app", ["lib/c.dart", "lib/none.dart"], signals, opt), undefined);
  assert.equal(markFor("other", ["lib/a.dart"], signals, opt), undefined);
  assert.equal(markFor("app", [], signals, opt), undefined);
});

test("warnings only is not hot; turning warnings off removes the mark", () => {
  const w = markFor("app", ["lib/b.dart"], signals, opt);
  assert.equal(w?.hot, false);
  assert.equal(markFor("app", ["lib/b.dart"], signals, { ...opt, includeWarnings: false }), undefined);
  const e = markFor("app", ["lib/a.dart"], signals, { ...opt, includeWarnings: false });
  assert.equal(e?.warnings, 0);
  assert.equal(e?.files[0].lints, undefined);
});

test("file names match without case where the file system ignores it", () => {
  assert.equal(markFor("app", ["LIB/A.dart"], signals, opt), undefined);
  assert.ok(markFor("app", ["LIB/A.dart"], signals, { ...opt, fold: true }));
});

test("lint violations are counted per file; odd rows and outside paths are dropped", () => {
  const text = JSON.stringify({
    violations: [
      { file: "lib/a.dart", severity: "error" },
      { file: "lib\\a.dart", severity: "warning" },
      { path: "/home/u/app/lib/b.dart", impact: "error" },
      { file: "../x.dart", severity: "error" },
      { file: "/etc/other.dart", severity: "error" },
      { file: "lib/c.dart", severity: "info" },
      "junk",
      null,
    ],
  });
  const m = parseLintViolations(text, "/home/u/app", false);
  assert.deepEqual(m.get("lib/a.dart"), { errors: 1, warnings: 1 });
  assert.deepEqual(m.get("lib/b.dart"), { errors: 1, warnings: 0 });
  assert.equal(m.size, 2);
  assert.equal(parseLintViolations("not json", undefined, false).size, 0);
  assert.equal(parseLintViolations("{}", undefined, false).size, 0);
});

test("the optional API is used only when it is version 1 or newer and has the member", () => {
  assert.equal(apiUsable(undefined), false);
  assert.equal(apiUsable({ apiVersion: 1 }), false);
  assert.equal(apiUsable({ apiVersion: "1", signalsForFiles: () => 0 }), false);
  assert.equal(apiUsable({ apiVersion: 0, signalsForFiles: () => 0 }), false);
  assert.equal(apiUsable({ apiVersion: 1, signalsForFiles: () => 0 }), true);
  assert.equal(apiUsable({ apiVersion: 2, signalsForFiles: () => 0 }), true);
});

test("an API reply is cleaned: unknown paths, bad numbers and empty answers are dropped", () => {
  const lookup = new Map([["/p/lib/a.dart", { project: "app", rel: "lib/a.dart" }], ["/p/lib/b.dart", { project: "app", rel: "lib/b.dart" }]]);
  const rows = readApiSignals(
    { files: [{ path: "/p/lib/a.dart", errors: 3.9, crashes: 1, warnings: -4, last: 5, title: "Boom\nnow" }, { path: "/etc/passwd", errors: 9 }, { path: "/p/lib/b.dart", errors: 0 }, 7, null] },
    lookup
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].logs, { errors: 3, warnings: 0, crashes: 1, last: 5, title: "Boom now" });
  assert.deepEqual(readApiSignals("nope", lookup), []);
  assert.deepEqual(readApiSignals(undefined, lookup), []);
  assert.equal(readApiSignals([{ path: "/p/lib/a.dart", crashes: 2 }], lookup).length, 1);
});

test("the lookback setting stays between 1 and 30 days", () => {
  assert.equal(clampLookbackDays(0), 1);
  assert.equal(clampLookbackDays(99), 30);
  assert.equal(clampLookbackDays("x"), 1);
  assert.equal(clampLookbackDays(7.4), 7);
});

test("only crash signals in files no open document names are listed", () => {
  const sig: LiveSignals = {
    app: {
      "lib/named.dart": { logs: { errors: 1, warnings: 0, crashes: 1 } },
      "lib/lone.dart": { logs: { errors: 2, warnings: 0, crashes: 0 } },
      "lib/crash.dart": { logs: { errors: 0, warnings: 0, crashes: 3 } },
      "lib/lintonly.dart": { lints: { errors: 5, warnings: 0 }, problems: { errors: 4, warnings: 0 } },
    },
  };
  const named = new Map([["app", new Set(["lib/named.dart"])]]);
  const out = unnamedFiles(sig, named, [{ id: "app", name: "App", bugsFolder: "bugs" }], false);
  assert.deepEqual(out.map((u) => u.file), ["lib/crash.dart", "lib/lone.dart"]);
  assert.equal(out[0].folder, "bugs");
});

test("the bugs folder is the first root named bugs", () => {
  assert.equal(bugsFolderOf(["docs", "docs/Bugs/", "bugs"]), "docs/Bugs");
  assert.equal(bugsFolderOf(["docs", "plans"]), undefined);
});

test("a new bug document carries the title, the signal, the file and the date", () => {
  const now = new Date(2026, 9, 27, 12).getTime();
  const d = bugDocument({ project: "app", projectName: "App", file: "lib/service/contact_sync.dart", logs: { errors: 3, warnings: 0, crashes: 1, title: "Null check failed" } }, now, 1);
  assert.equal(d.name, "BUG_CONTACT_SYNC.md");
  assert.match(d.text, /^# Null check failed/);
  assert.match(d.text, /Date: 2026-10-27/);
  assert.match(d.text, /File: `lib\/service\/contact_sync\.dart`/);
  assert.match(d.text, /1 crash, 3 errors in debug runs since 2026-10-26/);
  assert.match(d.text, /- \[ \]/);
});

// The honest-light rule: live evidence is information only.
const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "/p", roots: ["bugs", "docs"], ruleSets: [] }],
};
const rows: Classified[] = [
  { project: "app", path: "bugs/SYNC.md", status: "amber", kind: "bug", note: "" },
  { project: "app", path: "docs/quiet.md", status: "amber", kind: "plan", note: "" },
];
const mtimeMs = 1;
const fact = (text: string) => ({ size: text.length, mtimeMs, facts: readFacts(text, "x.md") });
const snapshot = {
  version: 1,
  takenAt: 1,
  projects: {
    app: {
      counts: {},
      folders: {},
      ruleCounts: {},
      greyFolders: {},
      files: {},
      facts: { "bugs/SYNC.md": fact("# Sync\nSee lib/a.dart and lib/b.dart.\n- [ ] fix\n"), "docs/quiet.md": fact("# Quiet\nSee lib/c.dart.\n- [ ] x\n") },
    },
  },
} as unknown as ScanSnapshot;
const healthy: Record<string, ProjectHealth> = { app: { lint: "passing", tests: "passing", lintDetail: "", testsDetail: "", clean: true } };
const live = { signals, includeWarnings: true, fold: false, unnamedBox: true };

test("live evidence marks the row and leaves every light and reason as it was", () => {
  const plain = buildBoard(cfg, rows, undefined, true, snapshot, undefined, healthy);
  const marked = buildBoard(cfg, rows, undefined, true, snapshot, undefined, healthy, { live });
  assert.deepEqual(marked.projects.map((p) => [p.light, p.reasons]), plain.projects.map((p) => [p.light, p.reasons]));
  assert.deepEqual(marked.items.map((i) => [i.status, i.severity, i.stopping]), plain.items.map((i) => [i.status, i.severity, i.stopping]));
  assert.equal(marked.items.find((i) => i.path === "bugs/SYNC.md")?.live?.hot, true);
  assert.equal(marked.items.find((i) => i.path === "docs/quiet.md")?.live, undefined);
  assert.equal(plain.items.every((i) => i.live === undefined), true);
});

test("a clean project with live errors is not made NO-GO and a GO is not made greener", () => {
  const go = buildBoard(cfg, [], undefined, true, snapshot, undefined, healthy, { live });
  assert.equal(go.projects[0].light, "go");
  const unverified = buildBoard(cfg, rows, undefined, true, snapshot, undefined, { app: { ...healthy.app, clean: false, lint: "missing" } }, { live });
  assert.notEqual(unverified.projects[0].light, "go");
});

test("the unnamed box lists a crash in a file no open document names, with the project's bugs folder", () => {
  const sig: LiveSignals = { app: { "lib/lone.dart": { logs: { errors: 0, warnings: 0, crashes: 2 } } } };
  const m = buildBoard(cfg, rows, undefined, true, snapshot, undefined, healthy, { live: { ...live, signals: sig } });
  assert.deepEqual(m.liveUnnamed?.map((u) => [u.file, u.folder]), [["lib/lone.dart", "bugs"]]);
  assert.equal(buildBoard(cfg, rows, undefined, true, snapshot, undefined, healthy, { live: { ...live, signals: sig, unnamedBox: false } }).liveUnnamed, undefined);
  assert.equal(buildBoard(cfg, rows, undefined, true, snapshot, undefined, healthy).liveUnnamed, undefined);
});

const t = new Proxy({} as BoardStrings, {
  get: (_o, k: string) =>
    k === "liveLogs" ? "{errors} errors, {crashes} crashes in debug runs" : k === "liveProblems" ? "{errors} errors, {warnings} warnings in Problems" : k === "liveLints" ? "{errors} lint errors, {warnings} lint warnings" : k === "handToChat" ? "" : `[${k}] {count}`,
});

test("the page shows a flame with a tooltip, escapes file names, and offers the button by index only", () => {
  const evil: LiveSignals = {
    app: {
      "lib/a.dart": { logs: { errors: 1, warnings: 0, crashes: 1 } },
      "lib/lone<img>.dart": { logs: { errors: 0, warnings: 0, crashes: 1 } },
    },
  };
  const snap2 = JSON.parse(JSON.stringify(snapshot)) as ScanSnapshot;
  const m = buildBoard(cfg, rows, undefined, true, snap2, undefined, healthy, { live: { ...live, signals: evil } });
  const html = renderBoard(m, t, "n");
  assert.match(html, /class="flame hot"/);
  assert.match(html, /1 errors, 1 crashes in debug runs/);
  assert.ok(!html.includes("lone<img>"), "file names are escaped");
  assert.match(html, /data-bug="0"/);
  assert.ok(!html.includes("data-bug=\"0\" data-path"), "no path in the button");
  const plain = renderBoard(buildBoard(cfg, rows, undefined, true, snap2, undefined, healthy), t, "n");
  assert.ok(!plain.includes('class="flame'));
  assert.ok(!plain.includes("data-bug="));
});

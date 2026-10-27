// The umbrella view of the Release Board: several projects on one page. The roll-up of
// lights, the open mark, the grey rows, the top bar controls and the hint; the order of the
// projects; and the safety check around projects that come and go by the user's choice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { hintBar, isUmbrella, openBadge, projectsButtons, rollupBar, rollupCounts, skippedBlock } from "../../board/boardHtmlProjects";
import { BoardModel, buildBoard } from "../../board/boardModel";
import { FileSource, ProjectSnapshot, ScanSnapshot, scanAll } from "../../board/scanner";
import { checkScan } from "../../board/safety";
import { BoardConfig, BoardStatus, Classified, ScanFile, emptyCounts } from "../../board/types";

const labels: Record<string, string> = {
  projects: "Projects",
  projectsTip: "Choose projects",
  settings: "Settings",
  settingsTip: "Open settings",
  hintText: "Only this project is shown.",
  hintAdd: "Add more projects",
  hintDismiss: "Dismiss",
  hintDismissTip: "Hide the hint",
  rollup: "{count} projects",
  open: "open",
  openTip: "Open in this window",
  skippedShort: "NOT READ",
  skip_missing: "Not found.",
  skip_notFolder: "Not a folder.",
  skip_unreadable: "Unreadable.",
  skip_overLimit: "Limit {max}.",
};
const t = new Proxy({ projectLabels: labels } as unknown as BoardStrings, {
  get: (o, k: string) => (k === "projectLabels" ? labels : k === "noGo" ? "NO-GO" : k === "unverified" ? "UNVERIFIED" : k === "go" ? "GO" : k in o ? (o as never)[k] : `[${k}]`),
});

function cfg(extraIds: string[] = [], skipped?: BoardConfig["skipped"]): BoardConfig {
  return {
    version: 1,
    ignore: [],
    ruleSets: {},
    projects: [
      ...extraIds.map((id) => ({ id, name: id.toUpperCase(), path: id, roots: [], ruleSets: [], extra: true })),
      { id: "app", name: "App", path: "app", roots: [], ruleSets: [] },
    ],
    ...(skipped ? { skipped } : {}),
  };
}

const row = (project: string, path: string, status: BoardStatus): Classified => ({ project, path, status, kind: "", note: "" });

function model(c: BoardConfig, rows: Classified[] = []): BoardModel {
  return buildBoard(c, rows, undefined, true);
}

test("the open project sorts before chosen ones whatever their importance, and only chosen ones are marked extra", () => {
  const c = cfg(["zed"]);
  c.projects[0].importance = "high";
  const m = model(c);
  assert.deepEqual(m.projects.map((p) => [p.id, p.extra]), [["app", undefined], ["zed", true]]);
});

test("the order of a board with no chosen project is unchanged", () => {
  const plain: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [
    { id: "low", path: "low", roots: [], ruleSets: [], importance: "low" },
    { id: "hi", path: "hi", roots: [], ruleSets: [], importance: "high" },
    { id: "mid", path: "mid", roots: [], ruleSets: [] },
  ] };
  const m = model(plain);
  assert.deepEqual(m.projects.map((p) => p.id), ["hi", "mid", "low"]);
  assert.equal(m.skipped, undefined);
  assert.ok(m.projects.every((p) => !("extra" in p)));
});

test("a chosen project is never greener than its evidence: no health result keeps it UNVERIFIED", () => {
  const m = model(cfg(["zed"]), []);
  assert.deepEqual(m.projects.map((p) => p.light), ["unverified", "unverified"]);
});

test("a red document in a chosen project makes that project NO-GO and leaves the open one alone", () => {
  const m = model(cfg(["zed"]), [row("zed", "bugs/a.md", "red")]);
  assert.deepEqual(m.projects.map((p) => [p.id, p.light]), [["app", "unverified"], ["zed", "no-go"]]);
});

test("the model carries the grey rows from the config", () => {
  const m = model(cfg([], [{ name: "gone", reason: "missing" }]));
  assert.deepEqual(m.skipped, [{ name: "gone", reason: "missing" }]);
});

test("the roll-up counts each light exactly", () => {
  const m = model(cfg(["a", "b", "c"]), [row("a", "bugs/x.md", "red"), row("b", "bugs/y.md", "red")]);
  assert.deepEqual(rollupCounts(m.projects), { noGo: 2, unverified: 2, go: 0 });
});

test("a single project has no roll-up, no open mark and no grey rows", () => {
  const m = model(cfg());
  assert.equal(isUmbrella(m), false);
  assert.equal(rollupBar(m, t), "");
  assert.equal(openBadge(m.projects[0], m, t), "");
  assert.equal(skippedBlock(m, t, 40), "");
  const html = renderBoard(m, t, "n");
  assert.ok(!html.includes('class="roll"'));
  assert.ok(!html.includes('class="tag otag"'));
});

test("with several projects the header states the total and how many are in each light", () => {
  const m = model(cfg(["a", "b"]), [row("a", "bugs/x.md", "red")]);
  assert.equal(
    rollupBar(m, t),
    '<div class="roll" role="status"><b>3 projects</b><span class="go no-go">1 NO-GO</span><span class="go unverified">2 UNVERIFIED</span><span class="go go zero">0 GO</span></div>'
  );
});

test("a chosen folder that could not be read is counted apart and never as a light", () => {
  const m = model(cfg([], [{ name: "gone", reason: "missing" }]));
  assert.equal(isUmbrella(m), true);
  assert.equal(
    rollupBar(m, t),
    '<div class="roll" role="status"><b>2 projects</b><span class="go no-go zero">0 NO-GO</span><span class="go unverified">1 UNVERIFIED</span><span class="go go zero">0 GO</span><span class="go skipped">1 NOT READ</span></div>'
  );
});

test("only the open project is marked, and only when chosen projects are shown", () => {
  const m = model(cfg(["zed"]));
  assert.equal(openBadge(m.projects[0], m, t), '<span class="tag otag" title="Open in this window">open</span>');
  assert.equal(openBadge(m.projects[1], m, t), "");
});

test("a grey row names the folder and the reason and carries no path", () => {
  const m = model(cfg([], [{ name: "gone<b>", reason: "missing" }, { name: "big", reason: "overLimit" }]));
  assert.equal(
    skippedBlock(m, t, 40),
    '<div class="vd skip"><b class="pn">gone&#60;b&#62;</b><span class="go skipped">NOT READ</span><span class="fn">Not found.</span></div>' +
      '<div class="vd skip"><b class="pn">big</b><span class="go skipped">NOT READ</span><span class="fn">Limit 40.</span></div>'
  );
});

test("the top bar has a Projects and a Settings button, each with a tooltip", () => {
  assert.equal(
    projectsButtons(t),
    '<button data-projects title="Choose projects" aria-label="Choose projects">Projects</button><button data-settings title="Open settings" aria-label="Open settings">Settings</button>'
  );
});

test("the hint is one line with the add and dismiss buttons, and only when asked for", () => {
  assert.equal(hintBar(false, t), "");
  assert.equal(hintBar(undefined, t), "");
  assert.equal(
    hintBar(true, t),
    '<div class="hint" role="note"><span class="f">Only this project is shown.</span><button data-projects>Add more projects</button><button data-hint-dismiss title="Hide the hint" aria-label="Hide the hint">Dismiss</button></div>'
  );
});

test("the page has the controls, the open mark and the roll-up in order, and sends only kinds of request", () => {
  const m = model(cfg(["zed"], [{ name: "gone", reason: "missing" }]));
  const html = renderBoard(m, t, "n", 7, { hint: true });
  const at = (s: string): number => html.indexOf(s);
  assert.ok(at("data-projects title=") > 0 && at("data-projects title=") < at('class="hint"'));
  assert.ok(at('class="hint"') < at('class="roll"'));
  assert.ok(at('class="roll"') < at('class="tag otag"'));
  assert.ok(at('class="tag otag"') < at('class="vd skip"'));
  assert.equal(html.match(/<script/g)?.length, 1);
  assert.ok(html.includes("type:'projects',rev:REV"));
  assert.ok(html.includes("type:'boardSettings',rev:REV"));
  assert.ok(html.includes("type:'hintDismiss',rev:REV"));
  assert.ok(!renderBoard(m, t, "n", 7).includes('class="hint"'));
});

test("every work list row names its project when several are shown", () => {
  const m = model(cfg(["zed"]), [row("zed", "bugs/a.md", "red"), row("app", "bugs/b.md", "red")]);
  const html = renderBoard(m, t, "n");
  assert.ok(html.includes('<span class="tag">ZED</span>'));
  assert.ok(html.includes('<span class="tag">App</span>'));
});

// Safety around projects that come and go by the user's choice.

function snapOf(...ids: string[]): ScanSnapshot {
  const projects: Record<string, ProjectSnapshot> = {};
  for (const id of ids) {
    projects[id] = { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: {} };
  }
  return { version: 1, takenAt: 0, projects };
}

test("scanning marks a chosen project's snapshot as extra and leaves the others alone", async () => {
  const empty: FileSource = { list: async (): Promise<ScanFile[]> => [], readHead: async () => "" };
  const r = await scanAll(cfg(["zed"]), empty);
  assert.equal(r.snapshot.projects.zed.extra, true);
  assert.equal("extra" in r.snapshot.projects.app, false);
});

test("a chosen project taken off the list is not a finding, a lost open project still is", () => {
  const accepted = snapOf("app", "zed");
  accepted.projects.zed.extra = true;
  const next = snapOf("app");
  assert.deepEqual(checkScan(accepted, next), { baseline: false, findings: [], clean: true });
  const lost = checkScan(snapOf("app", "web"), next);
  assert.deepEqual(lost.findings.map((f) => [f.kind, f.project]), [["project-gone", "web"]]);
  assert.equal(lost.clean, false);
});

test("a newly chosen project still needs an accepted scan of its own", () => {
  const r = checkScan(snapOf("app"), snapOf("app", "zed"));
  assert.deepEqual(r.findings.map((f) => [f.kind, f.project]), [["new-project", "zed"]]);
  assert.equal(r.clean, false);
});

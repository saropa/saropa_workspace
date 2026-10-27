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
  hidden: "Chosen projects hidden: {count}",
  hiddenTip: "Shown with the Projects button",
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

// The whole board is never greener than what was read.

import { BoardItem, BoardProject } from "../../board/boardModel";
import { boardLights, buildSidebarRows, hasDocuments, worstLight, SidebarLabels } from "../../board/sidebar";
import { hiddenNote } from "../../board/boardHtmlProjects";
import { lightTooltip, umbrellaLines } from "../../commands/boardStatusLight";
import { dropFailed } from "../../board/scanner";

const goProject: BoardProject = { id: "app", name: "App", light: "go", reasons: [], items: [] as BoardItem[], blocked: 0, blockedStopping: 0, counts: { ...emptyCounts(), green: 3 }, dependsOn: [] };

const sbLabels: SidebarLabels = {
  light: { "no-go": "NO-GO", unverified: "UNVERIFIED", go: "GO" },
  blockerOne: "1 blocker",
  blockerMany: "{count} blockers",
  reasons: { baseline: "b", grey: "g", health: "h", unread: "u" },
  causeLint: "l",
  causeBuild: "b",
  causeDeps: "d",
  causeTests: "t",
  causeBlocked: "{count}",
  causeHeld: "held",
  umbrella: {
    skipped: { missing: "Not found.", notFolder: "Not a folder.", unreadable: "Unreadable.", overLimit: "Over the limit.", timedOut: "Timed out." },
    hidden: "Chosen projects hidden: {count}",
  },
};
const sbOpts = { blockersPerProject: 3, expandProjects: "whenNoGo" as const };

test("one GO project and one folder that could not be read: the aggregate is UNVERIFIED", () => {
  const skipped = [{ name: "gone", reason: "missing" as const }];
  assert.equal(worstLight(boardLights({ projects: [goProject] })), "go");
  assert.equal(worstLight(boardLights({ projects: [goProject], skipped })), "unverified");
  assert.deepEqual(boardLights({ projects: [goProject], skipped }), ["go", "unverified"]);
});

test("a NO-GO project still wins over a folder that could not be read", () => {
  assert.equal(worstLight(boardLights({ projects: [{ ...goProject, light: "no-go" }], skipped: [{ name: "x", reason: "missing" }] })), "no-go");
});

test("the sidebar has one UNVERIFIED row per unread folder, with its name and reason", () => {
  const rows = buildSidebarRows({ projects: [goProject], skipped: [{ name: "gone", reason: "missing" }, { name: "slow", reason: "timedOut" }] }, sbOpts, sbLabels);
  assert.deepEqual(rows.map((r) => [r.projectId, r.name, r.light, r.description, r.note]), [
    ["app", "App", "go", "GO", undefined],
    ["skipped/0", "gone", "unverified", "UNVERIFIED · Not found.", undefined],
    ["skipped/1", "slow", "unverified", "UNVERIFIED · Timed out.", undefined],
  ]);
  assert.deepEqual(rows[1].tooltip, ["gone: UNVERIFIED", "Not found."]);
});

test("a sidebar with only unread folders still has rows", () => {
  assert.equal(hasDocuments({ projects: [], skipped: [{ name: "gone", reason: "missing" }] }), true);
  assert.equal(hasDocuments({ projects: [] }), false);
});

test("the sidebar says how many chosen projects are hidden, as a note without a light", () => {
  const rows = buildSidebarRows({ projects: [goProject], hidden: 3 }, sbOpts, sbLabels);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].name, rows[1].note, rows[1].projectId], ["Chosen projects hidden: 3", true, "hidden"]);
  assert.equal(buildSidebarRows({ projects: [goProject] }, sbOpts, sbLabels).length, 1);
});

test("the status bar tooltip names what is not read and how many are hidden", () => {
  assert.deepEqual(umbrellaLines([{ name: "gone", reason: "missing" }], 2), ["Not read: gone (The folder was not found.)", "Chosen projects hidden: 2"]);
  assert.deepEqual(umbrellaLines(undefined, 0), []);
  assert.equal(lightTooltip("unverified", undefined, [], "base", ["Not read: gone (x)"]), "UNVERIFIED\nNot read: gone (x)\nbase");
});

test("the page says how many chosen projects are hidden", () => {
  const c = cfg();
  c.hidden = 2;
  const m = model(c);
  assert.equal(m.hidden, 2);
  assert.equal(hiddenNote(m, t), '<p class="note" title="Shown with the Projects button">Chosen projects hidden: 2</p>');
  assert.equal(hiddenNote(model(cfg()), t), "");
});

test("a chosen project whose scan failed is left out and shown as a grey row", () => {
  const out = dropFailed(cfg(["zed", "yak"], [{ name: "old", reason: "missing" }]), [{ id: "zed", name: "ZED", reason: "timedOut" }]);
  assert.deepEqual(out.projects.map((p) => p.id), ["yak", "app"]);
  assert.deepEqual(out.skipped, [{ name: "old", reason: "missing" }, { name: "ZED", reason: "timedOut" }]);
  const same = cfg();
  assert.equal(dropFailed(same, undefined), same);
});

test("a slow chosen project becomes a failed project and the others are still scanned", async () => {
  const source: FileSource = {
    list: async (dir): Promise<ScanFile[]> => (dir === "zed" ? new Promise<ScanFile[]>(() => undefined) : [{ path: "bugs/a.md", size: 1, mtimeMs: 1 }]),
    readHead: async () => "",
  };
  const c = cfg(["zed"]);
  c.projects.forEach((p) => (p.roots = ["bugs"]));
  const r = await scanAll(c, source, undefined, 0, "all", 20);
  assert.deepEqual(r.failed, [{ id: "zed", name: "ZED", reason: "timedOut" }]);
  assert.deepEqual(Object.keys(r.snapshot.projects), ["app"]);
  assert.deepEqual(r.rows.map((x) => x.project), ["app"]);
});

test("a chosen project that throws becomes a failed project; an open project that throws still fails the scan", async () => {
  const bad = (dir: string): FileSource => ({ list: async () => { if (dir) { throw new Error("EACCES"); } return []; }, readHead: async () => "" });
  const c = cfg(["zed"]);
  c.projects.forEach((p) => (p.roots = ["bugs"]));
  const only: FileSource = { list: async (dir) => { if (dir === "zed") { throw new Error("EACCES"); } return []; }, readHead: async () => "" };
  const r = await scanAll(c, only);
  assert.deepEqual(r.failed, [{ id: "zed", name: "ZED", reason: "unreadable" }]);
  await assert.rejects(scanAll(c, bad("x")));
});

test("the scanner tells the source to skip links only for chosen projects", async () => {
  const seen: Array<[string, boolean | undefined]> = [];
  const source: FileSource = { list: async (dir, _root, _accept, noLinks) => { seen.push([dir, noLinks]); return []; }, readHead: async () => "" };
  const c = cfg(["zed"]);
  c.projects.forEach((p) => (p.roots = ["bugs"]));
  await scanAll(c, source);
  assert.deepEqual(seen.sort(), [["app", false], ["zed", true]]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardItem, BoardProject } from "../../board/boardModel";
import { emptyCounts } from "../../board/types";
import {
  SidebarLabels,
  asExpandMode,
  asStartupMode,
  buildSidebarRows,
  hasDocuments,
  clampBlockers,
  lightLook,
  projectsFound,
  shouldExpand,
  shouldOpenOnStartup,
  worstLight,
} from "../../board/sidebar";

const labels: SidebarLabels = {
  light: { "no-go": "NO-GO", unverified: "UNVERIFIED", go: "GO" },
  blockerOne: "1 blocker",
  blockerMany: "{count} blockers",
  reasons: { baseline: "scan not accepted", grey: "{count} unplaced", health: "no lint or test result", unread: "unread" },
  causeLint: "lint failing",
  causeBuild: "build failing",
  causeDeps: "dependencies vulnerable",
  causeTests: "tests failing",
  causeBlocked: "{count} in blocked folders",
  causeHeld: "held: red in the last accepted scan",
};

function item(id: number, title: string, status: BoardItem["status"], stopping = false): BoardItem {
  return { id, project: "app", path: `bugs/${title}.md`, title, status, kind: "", hub: false, waitsOn: [], blocksCount: 0, pinned: false, stopping };
}

function project(light: BoardProject["light"], items: BoardItem[], reasons: BoardProject["reasons"] = []): BoardProject {
  return { id: "app", name: "App", light, reasons, items, blocked: 0, blockedStopping: 0, counts: { ...emptyCounts(), grey: 2 }, dependsOn: [] };
}

const opts = { blockersPerProject: 3, expandProjects: "whenNoGo" as const };

test("description names the light and the blocker count", () => {
  const rows = buildSidebarRows({ projects: [project("no-go", [item(0, "a", "red"), item(1, "b", "red"), item(2, "c", "amber", true), item(3, "d", "amber")])] }, opts, labels);
  assert.equal(rows[0].description, "NO-GO · 3 blockers");
  assert.deepEqual(rows[0].blockers.map((b) => b.title), ["a", "b", "c"]);
});

test("one blocker uses the singular; none leaves the word alone", () => {
  assert.equal(buildSidebarRows({ projects: [project("no-go", [item(0, "a", "red")])] }, opts, labels)[0].description, "NO-GO · 1 blocker");
  assert.equal(buildSidebarRows({ projects: [project("go", [])] }, opts, labels)[0].description, "GO");
});

test("blockers are capped and keep the model's order; zero lists none", () => {
  const items = [item(5, "x", "red"), item(6, "y", "red"), item(7, "z", "red")];
  const two = buildSidebarRows({ projects: [project("no-go", items)] }, { ...opts, blockersPerProject: 2 }, labels)[0];
  assert.deepEqual(two.blockers.map((b) => b.id), [5, 6]);
  assert.equal(two.description, "NO-GO · 3 blockers");
  const none = buildSidebarRows({ projects: [project("no-go", items)] }, { ...opts, blockersPerProject: 0 }, labels)[0];
  assert.deepEqual(none.blockers, []);
  assert.equal(none.expand, false);
});

test("tooltip lists the reasons for an unverified project", () => {
  const row = buildSidebarRows({ projects: [project("unverified", [], ["grey", "health"])] }, opts, labels)[0];
  assert.deepEqual(row.tooltip, ["App: UNVERIFIED", "2 unplaced", "no lint or test result"]);
});

test("the expand rule", () => {
  assert.equal(shouldExpand("never", "no-go"), false);
  assert.equal(shouldExpand("whenNoGo", "no-go"), true);
  assert.equal(shouldExpand("whenNoGo", "unverified"), false);
  assert.equal(shouldExpand("always", "go"), true);
});

test("light to icon and theme color", () => {
  assert.deepEqual(lightLook("no-go"), { icon: "error", color: "charts.red" });
  assert.equal(lightLook("unverified").color, "charts.yellow");
  assert.equal(lightLook("go").color, "charts.green");
});

test("worst light", () => {
  assert.equal(worstLight([]), undefined);
  assert.equal(worstLight(["go", "unverified"]), "unverified");
  assert.equal(worstLight(["go", "no-go", "unverified"]), "no-go");
  assert.equal(worstLight(["go"]), "go");
});

test("settings are coerced to known values", () => {
  assert.equal(asExpandMode("junk"), "whenNoGo");
  assert.equal(asExpandMode("always"), "always");
  assert.equal(asStartupMode(undefined), "whenProjectsFound");
  assert.equal(asStartupMode("never"), "never");
  assert.equal(clampBlockers(50), 10);
  assert.equal(clampBlockers(-2), 0);
  assert.equal(clampBlockers("x"), 3);
  assert.equal(clampBlockers(2.4), 2);
});

test("startup opening", () => {
  assert.equal(shouldOpenOnStartup("never", true, true), false);
  assert.equal(shouldOpenOnStartup("whenProjectsFound", false, true), false);
  assert.equal(shouldOpenOnStartup("whenProjectsFound", true, true), true);
  assert.equal(shouldOpenOnStartup("always", false, true), true);
  assert.equal(shouldOpenOnStartup("always", true, false), false);
});

test("projects found needs at least one open document", () => {
  const empty: BoardProject = { ...project("go", []), counts: emptyCounts() };
  assert.equal(projectsFound({ projects: [empty] }), false);
  assert.equal(projectsFound({ projects: [empty, project("go", [])] }), false, "grey alone is not an open document");
  const open: BoardProject = { ...empty, counts: { ...emptyCounts(), amber: 1 } };
  assert.equal(projectsFound({ projects: [empty, open] }), true);
  assert.equal(projectsFound({ projects: [{ ...empty, counts: { ...emptyCounts(), green: 4, reference: 2 } }] }), false);
  assert.equal(projectsFound({ projects: [] }), false);
});

test("a NO-GO is always explained: blocked folders, failing evidence, held red", () => {
  const blocked = { ...project("no-go", []), blockedStopping: 2 };
  const a = buildSidebarRows({ projects: [blocked] }, opts, labels)[0];
  assert.equal(a.description, "NO-GO · 2 blockers");
  assert.ok(a.tooltip.includes("2 in blocked folders"));
  const lint = { ...project("no-go", []), health: { lint: "failing", tests: "failing", lintDetail: "", testsDetail: "", clean: false } } as BoardProject;
  const b = buildSidebarRows({ projects: [lint] }, opts, labels)[0];
  assert.equal(b.description, "NO-GO · lint failing");
  assert.deepEqual(b.tooltip.slice(1, 3), ["lint failing", "tests failing"]);
  const held = buildSidebarRows({ projects: [project("no-go", [])] }, opts, labels)[0];
  assert.equal(held.description, "NO-GO · held: red in the last accepted scan");
  assert.equal(buildSidebarRows({ projects: [project("unverified", [])] }, opts, labels)[0].description, "UNVERIFIED");
});

test("the sidebar shows rows for a clean project but not for an empty one", () => {
  const empty: BoardProject = { ...project("go", []), counts: emptyCounts() };
  assert.equal(hasDocuments({ projects: [empty] }), false);
  assert.equal(hasDocuments({ projects: [{ ...empty, counts: { ...emptyCounts(), green: 3 } }] }), true);
});

test("a stale note is added to the description and the tooltip", () => {
  const row = buildSidebarRows({ projects: [project("no-go", [item(0, "a", "red")])] }, { ...opts, staleNote: "updating…" }, labels)[0];
  assert.equal(row.description, "NO-GO · 1 blocker (updating…)");
  assert.equal(row.tooltip[row.tooltip.length - 1], "updating…");
  assert.equal(buildSidebarRows({ projects: [project("go", [])] }, opts, labels)[0].description, "GO");
});

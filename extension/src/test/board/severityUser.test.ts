// A severity chosen by the user for one document: how it is stored, that it wins over the
// computed one, and that a lowered severity is counted and shown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SEVERITY_KEY, clearDocStatus, docStatusKeys, setDocSeverity, severityOverrides } from "../../board/ruleAssign";
import { buildSidebarRows } from "../../board/sidebar";
import { fromModel } from "../../board/handoff";
import { umbrellaLines } from "../../commands/boardStatusLight";
import { buildBoard } from "../../board/boardModel";
import { renderBoard } from "../../board/boardHtml";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";
import { BoardConfig, Classified, emptyCounts } from "../../board/types";
import { strings } from "../../views/boardStrings";

const set = (text: string | undefined, severity: Parameters<typeof setDocSeverity>[1]["severity"], path = "docs/A.md") => setDocSeverity(text, { project: "app", path, severity });

test("a severity is stored as one entry per document and replaced, not repeated", () => {
  const a = set(undefined, "low");
  assert.ok(a.ok);
  assert.deepEqual(JSON.parse(a.text), { version: 1, [SEVERITY_KEY]: [{ project: "app", path: "docs/A.md", severity: "low" }] });
  const b = set(a.text, "high");
  assert.ok(b.ok);
  assert.deepEqual(JSON.parse(b.text)[SEVERITY_KEY], [{ project: "app", path: "docs/A.md", severity: "high" }]);
  const c = set(b.text, "medium", "docs/B.md");
  assert.ok(c.ok);
  assert.equal(JSON.parse(c.text)[SEVERITY_KEY].length, 2);
});

test("Back to automatic removes the entry and the key when it was the last", () => {
  const a = set('{"version":1,"profile":"rush"}\n', "low");
  assert.ok(a.ok);
  const b = set(a.text, undefined);
  assert.ok(b.ok);
  assert.deepEqual(JSON.parse(b.text), { version: 1, profile: "rush" });
  assert.deepEqual(set(b.text, undefined), { ok: false, reason: "none" });
});

test("everything else in the file, its indent and its line ends are kept", () => {
  const before = '{\r\n\t"version": 1,\r\n\t"pinned": ["app/docs/a.md"]\r\n}\r\n';
  const r = set(before, "critical");
  assert.ok(r.ok);
  assert.ok(r.text.startsWith('{\r\n\t"version": 1,'));
  assert.ok(r.text.endsWith("}\r\n"));
  assert.equal(r.text.replace(/\r\n/g, "").includes("\n"), false);
  assert.deepEqual(JSON.parse(r.text).pinned, ["app/docs/a.md"]);
});

test("a file that does not parse, repeats a key, has the wrong shape or a wildcard path is refused", () => {
  assert.deepEqual(set("{nope", "low"), { ok: false, reason: "parse" });
  assert.deepEqual(set('{"a":1,"a":2}', "low"), { ok: false, reason: "lossy" });
  assert.deepEqual(set("[]", "low"), { ok: false, reason: "shape" });
  assert.deepEqual(set('{"severityOverrides":{}}', "low"), { ok: false, reason: "shape" });
  assert.deepEqual(set("{}", "low", "docs/*.md"), { ok: false, reason: "glob" });
  assert.deepEqual(set("{}", "huge" as never), { ok: false, reason: "glob" });
});

test("only well-formed entries with a known level count, the first of a document wins", () => {
  const m = severityOverrides({
    severityOverrides: [
      { project: "app", path: "docs/A.md", severity: "low" },
      { project: "app", path: "docs/A.md", severity: "high" },
      { project: "app", path: "docs/B.md", severity: "urgent" },
      { project: "app", path: "docs/*.md", severity: "low" },
      { project: 1, path: "docs/C.md", severity: "low" },
      null,
    ],
  });
  assert.deepEqual([...m], [["app\tdocs/A.md", "low"]]);
  assert.equal(severityOverrides({ severityOverrides: "x" }).size, 0);
  assert.equal(severityOverrides({}).size, 0);
});

test("clearing a status takes away only the board's rules for that exact path and project", () => {
  const text = JSON.stringify({
    version: 1,
    ruleSets: {
      "my-overrides": {
        rules: [
          { id: "status-docs-a-md", when: { path: "docs/A.md", project: "app" }, set: { status: "green", final: true } },
          { id: "status-docs-a-md-2", when: { path: "docs/A.md", project: "other" }, set: { status: "green", final: true } },
          { id: "mine", when: { path: "docs/A.md", project: "app" }, set: { status: "blue" } },
        ],
      },
    },
    projects: [{ id: "app", rules: [{ id: "status-docs-a-md-3", when: { path: "docs/A.md", project: "app" }, set: { status: "red", final: true } }] }],
  });
  const r = clearDocStatus(text, { project: "app", path: "docs/A.md" });
  assert.ok(r.ok);
  const out = JSON.parse(r.text);
  assert.deepEqual(out.ruleSets["my-overrides"].rules.map((x: { id: string }) => x.id), ["status-docs-a-md-2", "mine"]);
  assert.deepEqual(out.projects[0].rules, []);
  assert.deepEqual(clearDocStatus("{}", { project: "app", path: "docs/A.md" }), { ok: false, reason: "none" });
});

const cfg = (over: BoardConfig["severityOverrides"], profile: BoardConfig["profile"] = "deliberate"): BoardConfig => ({
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  profile,
  severityOverrides: over,
});
const row = (path: string, status: Classified["status"] = "amber", rule?: string, note = ""): Classified => ({ project: "app", path, status, kind: "", note, ...(rule ? { rule } : {}) });
const snap = (docs: Record<string, string>): ScanSnapshot => ({
  version: 1,
  takenAt: 1,
  projects: { app: { counts: emptyCounts(), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(Object.entries(docs).map(([p, t]) => [p, { size: 1, mtimeMs: 1, facts: readFacts(t, p) }])) } },
});
const BLOCKER = "# Refund and billing bug\n";
const CALM = "# Color tweak\n";

test("a user severity wins over the computed one, in the item, the light and the sort", () => {
  const rows = [row("docs/A.md"), row("docs/B.md")];
  const s = snap({ "docs/A.md": BLOCKER, "docs/B.md": CALM });
  const plain = buildBoard(cfg(undefined), rows, undefined, true, s);
  assert.equal(plain.projects[0].light, "no-go");
  assert.equal(plain.items[0].path, "docs/A.md");
  const lowered = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "low" }]), rows, undefined, true, s);
  const a = lowered.items.find((i) => i.path === "docs/A.md");
  assert.equal(a?.severity, "low");
  assert.equal(a?.severityByUser, true);
  assert.equal(a?.stopping, false);
  assert.equal(lowered.projects[0].light, "unverified", "not no-go: the user lowered the only blocker");
  const raised = buildBoard(cfg([{ project: "app", path: "docs/B.md", severity: "extreme" }]), rows, undefined, true, s);
  assert.equal(raised.items.find((i) => i.path === "docs/B.md")?.stopping, true);
  assert.equal(raised.projects[0].light, "no-go", "raising a severity can only make the light worse");
});

test("a lowered severity of a document that would block is counted; a raised one is not counted as lowered", () => {
  const rows = [row("docs/A.md"), row("docs/B.md")];
  const s = snap({ "docs/A.md": BLOCKER, "docs/B.md": CALM });
  const m = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "low" }, { project: "app", path: "docs/B.md", severity: "extreme" }]), rows, undefined, true, s);
  assert.deepEqual(m.byUser, { count: 2, lowered: 1 });
  assert.equal(buildBoard(cfg(undefined), rows, undefined, true, s).byUser, undefined);
  const same = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "critical" }]), rows, undefined, true, s);
  assert.deepEqual(same.byUser, { count: 1, lowered: 0 }, "still blocks under the profile");
});

test("a pinned document keeps stopping the release whatever severity is chosen", () => {
  const rows = [row("docs/A.md")];
  const s = snap({ "docs/A.md": BLOCKER });
  const m = buildBoard({ ...cfg([{ project: "app", path: "docs/A.md", severity: "low" }]), pinned: ["app/docs/A.md"] }, rows, undefined, true, s);
  assert.equal(m.items[0].stopping, true);
  assert.deepEqual(m.byUser, { count: 1, lowered: 0 });
});

test("a waiting (blocked) document counts with the severity chosen", () => {
  const rows = [row("docs/A.md", "amber", undefined, "blocked")];
  const s = snap({ "docs/A.md": BLOCKER });
  assert.equal(buildBoard(cfg(undefined), rows, undefined, true, s).projects[0].light, "no-go");
  const m = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "low" }]), rows, undefined, true, s);
  assert.equal(m.projects[0].light, "unverified");
  assert.deepEqual(m.byUser, { count: 1, lowered: 1 });
});

test("a document whose text was not read ignores the chosen severity and keeps the board unverified", () => {
  const rows = [row("docs/A.md")];
  const m = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "low" }]), rows, undefined, true, snap({}));
  assert.equal(m.items[0].severity, undefined);
  assert.equal(m.items[0].severityByUser, undefined);
  assert.equal(m.byUser, undefined);
});

test("a severity for another project or another path changes nothing", () => {
  const rows = [row("docs/A.md")];
  const s = snap({ "docs/A.md": BLOCKER });
  const m = buildBoard(cfg([{ project: "other", path: "docs/A.md", severity: "low" }, { project: "app", path: "docs/Z.md", severity: "low" }]), rows, undefined, true, s);
  assert.equal(m.items[0].severity, "extreme");
  assert.equal(m.byUser, undefined);
});

const statusRule = (id: string, path: string, project = "app", final = true) => ({ id, when: { path, project }, set: { status: "green" as const, ...(final ? { final: true } : {}) } });

test("a status is marked only when a board-written rule names exactly that project and path", () => {
  const rows = [row("docs/A.md", "amber", "status-docs-a-md"), row("docs/B.md", "amber", "status-table"), row("docs/C.md", "amber", "assigned-docs"), row("docs/D.md", "amber", "status-docs-d-md"), row("docs/E.md", "amber", "status-docs-e-md")];
  const c: BoardConfig = {
    ...cfg(undefined),
    ruleSets: {
      "my-overrides": { rules: [statusRule("status-docs-a-md", "docs/A.md"), statusRule("status-docs-d-md", "docs/D.md", "other"), statusRule("status-docs-e-md", "docs/E.md", "app", false)] },
      "doc-kinds": { rules: [{ id: "status-table", when: { path: "docs/B.md", project: "app" }, set: { status: "amber", final: true } }] },
    },
  };
  const m = buildBoard(c, rows, undefined, true, snap({}));
  assert.deepEqual(m.items.map((i) => [i.path, i.statusByUser === true]), [["docs/A.md", true], ["docs/B.md", false], ["docs/C.md", false], ["docs/D.md", false], ["docs/E.md", false]]);
});

test("the mark and Back to automatic agree: what docStatusKeys finds, clearDocStatus removes", () => {
  const c = { ruleSets: { "my-overrides": { rules: [statusRule("status-a", "docs/A.md"), statusRule("status-b", "docs/B.md", "other"), statusRule("status-c", "docs/C.md", "app", false)] } } };
  assert.deepEqual([...docStatusKeys(c)].sort(), ["app\tdocs/A.md", "other\tdocs/B.md"]);
  assert.equal(clearDocStatus(JSON.stringify(c), { project: "app", path: "docs/C.md" }).ok, false, "a rule that is not final is not the board's");
  assert.equal(clearDocStatus(JSON.stringify(c), { project: "app", path: "docs/A.md" }).ok, true);
  assert.equal(clearDocStatus(JSON.stringify(c), { project: "app", path: "docs/B.md" }).ok, false, "another project's rule is not removed");
});

test("a project and path that would join into the same text do not collide", () => {
  const m = severityOverrides({ severityOverrides: [{ project: "a", path: "b/c.md", severity: "low" }, { project: "a/b", path: "c.md", severity: "high" }] });
  assert.equal(m.size, 2);
});

test("a lowered blocker is counted per project, in the sidebar tooltip and in the status bar tooltip", () => {
  const rows = [row("docs/A.md")];
  const m = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "low" }]), rows, undefined, true, snap({ "docs/A.md": BLOCKER }));
  assert.equal(m.projects[0].loweredByUser, 1);
  const labels = { light: { "no-go": "NO-GO", unverified: "UNVERIFIED", go: "GO" }, blockerOne: "1 blocker", blockerMany: "{count} blockers", causeLint: "l", causeBuild: "b", causeDeps: "d", causeTests: "t", causeBlocked: "{count}", causeHeld: "h", loweredByUser: "{count} lowered by hand", reasons: { baseline: "x", grey: "{count}", health: "h", unread: "u" } };
  const row0 = buildSidebarRows(m, { blockersPerProject: 3, expandProjects: "never" } as never, labels as never)[0];
  assert.ok(row0.tooltip.includes("1 lowered by hand"));
  const plain = buildBoard(cfg(undefined), rows, undefined, true, snap({ "docs/A.md": BLOCKER }));
  assert.equal(plain.projects[0].loweredByUser, undefined);
  assert.equal(buildSidebarRows(plain, { blockersPerProject: 3, expandProjects: "never" } as never, labels as never)[0].tooltip.some((x) => x.includes("lowered")), false);
  assert.ok(umbrellaLines(undefined, undefined, 2).some((x) => x.includes("2 severities set by hand are below a level that stops the release")));
  assert.deepEqual(umbrellaLines(undefined, undefined, 0), []);
});

test("the hand-off says when the severity was set by hand", () => {
  const m = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "extreme" }]), [row("docs/A.md")], undefined, true, snap({ "docs/A.md": CALM }));
  assert.equal(fromModel(m, m.items, {}).items[0].severityBy, "user");
  const plain = buildBoard(cfg(undefined), [row("docs/A.md")], undefined, true, snap({ "docs/A.md": BLOCKER }));
  assert.equal(fromModel(plain, plain.items, {}).items[0].severityBy, "auto");
});

test("the page marks what the user set, says so in the tooltip and counts lowered severities in the summary", () => {
  const rows = [row("docs/A.md", "red", "status-docs-a-md"), row("docs/B.md")];
  const m = buildBoard(cfg([{ project: "app", path: "docs/A.md", severity: "low" }]), rows, undefined, true, snap({ "docs/A.md": BLOCKER, "docs/B.md": CALM }));
  const html = renderBoard(m, strings(), "n");
  assert.ok(html.includes("Set by hand in the rules file. Back to automatic in the row menu."));
  assert.ok(/class="note byuser"[^>]*>[^]*<span class="pill"[^>]*>1<\/span> severities set by hand in the rules file, <span class="pill"[^>]*>1<\/span> of them lowered below a level that stops the release/.test(html));
  assert.ok(html.includes("Change severity") && html.includes("Back to automatic"));
  const none = renderBoard(buildBoard(cfg(undefined), [row("docs/A.md")], undefined, true, snap({ "docs/A.md": BLOCKER })), strings(), "n");
  assert.equal(none.includes("byuser"), false);
  assert.equal(none.includes("Set by hand"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardItem, BoardProject } from "../../board/boardModel";
import { emptyCounts } from "../../board/types";
import { renderBoard } from "../../board/boardHtml";
import { SinceLabels, clampListed, diffSeen, digestOf, readSeen, sinceLines, MAX_PROJECTS, MAX_RECORDED } from "../../board/sinceLast";

const labels: SinceLabels = {
  newOne: "1 new blocker",
  newMany: "{count} new blockers",
  clearedOne: "1 blocker cleared",
  clearedMany: "{count} blockers cleared",
  lightMoved: "went from {from} to {to}",
  more: "and {count} more",
  reportStandup: "standup digest: {count} commits",
  reportDelta: "since yesterday: {count} commits",
  light: { "no-go": "NO-GO", unverified: "UNVERIFIED", go: "GO" },
};

function item(title: string, status: BoardItem["status"] = "red", stopping = false): BoardItem {
  return { id: 0, project: "app", path: `bugs/${title}.md`, title, status, kind: "", hub: false, waitsOn: [], blocksCount: 0, pinned: false, stopping };
}

function project(light: BoardProject["light"], items: BoardItem[], id = "app"): BoardProject {
  return { id, name: id === "app" ? "App" : id, light, reasons: [], items, blocked: 0, blockedStopping: 0, counts: emptyCounts(), dependsOn: [] };
}

const board = (...projects: BoardProject[]) => ({ projects });

test("digest keeps blockers only, not other open items", () => {
  const rec = digestOf(board(project("no-go", [item("A"), item("B", "amber"), item("C", "amber", true)])), 5);
  assert.deepEqual(Object.values(rec.projects.app.blockers).sort(), ["A", "C"]);
  assert.equal(rec.at, 5);
});

test("digest caps blockers and title length", () => {
  const many = Array.from({ length: MAX_RECORDED + 20 }, (_, i) => item(`t${i}`));
  assert.equal(Object.keys(digestOf(board(project("no-go", many)), 0).projects.app.blockers).length, MAX_RECORDED);
  const long = digestOf(board(project("no-go", [item("x".repeat(500))])), 0);
  assert.equal(Object.values(long.projects.app.blockers)[0].length, 120);
});

test("no record or no change gives no result", () => {
  const now = digestOf(board(project("no-go", [item("A")])), 2);
  assert.equal(diffSeen(undefined, now), undefined);
  assert.equal(diffSeen(digestOf(board(project("no-go", [item("A")])), 1), now), undefined);
});

test("new and cleared blockers are named", () => {
  const seen = digestOf(board(project("no-go", [item("A"), item("B")])), 1);
  const now = digestOf(board(project("no-go", [item("B"), item("C")])), 2);
  const d = diffSeen(seen, now);
  assert.equal(d?.since, 1);
  assert.deepEqual(d?.changes[0].added, ["C"]);
  assert.deepEqual(d?.changes[0].cleared, ["A"]);
  assert.deepEqual(d?.changes[0].addedKeys, ["app/bugs/C.md"], "the new blocker's row key, for the dotted mark");
  assert.equal(d?.changes[0].lightFrom, undefined);
});

test("a light change alone is a change, either way", () => {
  const worse = diffSeen(digestOf(board(project("unverified", [])), 1), digestOf(board(project("no-go", [])), 2));
  assert.equal(worse?.changes[0].lightFrom, "unverified");
  assert.equal(worse?.changes[0].lightTo, "no-go");
  const better = diffSeen(digestOf(board(project("no-go", [])), 1), digestOf(board(project("go", [])), 2));
  assert.equal(better?.changes[0].lightTo, "go");
});

test("a project that is new or gone is not a change", () => {
  const seen = digestOf(board(project("no-go", [item("A")]), project("go", [], "old")), 1);
  const now = digestOf(board(project("no-go", [item("A")]), project("no-go", [item("Z")], "fresh")), 2);
  assert.equal(diffSeen(seen, now), undefined);
});

test("an open item that stops being a blocker counts as cleared", () => {
  const seen = digestOf(board(project("no-go", [item("A", "amber", true)])), 1);
  const now = digestOf(board(project("unverified", [item("A", "amber", false)])), 2);
  assert.deepEqual(diffSeen(seen, now)?.changes[0].cleared, ["A"]);
});

test("lines word the counts, the light and the details", () => {
  const seen = digestOf(board(project("unverified", [item("Old")])), 1);
  const now = digestOf(board(project("no-go", [item("N1"), item("N2"), item("N3")])), 2);
  const [line] = sinceLines(diffSeen(seen, now)!, labels, 2);
  assert.equal(line.text, "App: 3 new blockers, 1 blocker cleared, went from UNVERIFIED to NO-GO");
  assert.deepEqual(line.details, ["+ N1", "+ N2", "and 1 more", "- Old"]);
});

test("single counts use the singular words", () => {
  const seen = digestOf(board(project("no-go", [item("A")])), 1);
  const now = digestOf(board(project("no-go", [item("B")])), 2);
  assert.equal(sinceLines(diffSeen(seen, now)!, labels, 5)[0].text, "App: 1 new blocker, 1 blocker cleared");
});

test("a stored record is checked, and a bad one is dropped", () => {
  const rec = digestOf(board(project("no-go", [item("A")])), 9);
  assert.deepEqual(readSeen(JSON.parse(JSON.stringify(rec))), rec);
  assert.equal(readSeen(undefined), undefined);
  assert.equal(readSeen({ version: 2, at: 1, projects: {} }), undefined);
  assert.equal(readSeen({ version: 1, at: "x", projects: {} }), undefined);
  assert.equal(readSeen({ version: 1, at: 1, projects: { a: { name: "A", light: "purple", blockers: {} } } }), undefined);
  assert.equal(readSeen({ version: 1, at: 1, projects: { a: { name: "A", light: "go", blockers: null } } }), undefined);
});

test("listed limit is a whole number from 1 to 20", () => {
  assert.equal(clampListed(5), 5);
  assert.equal(clampListed(0), 1);
  assert.equal(clampListed(99), 20);
  assert.equal(clampListed("x"), 5);
  assert.equal(clampListed(NaN), 5);
});

test("the page escapes the strip and shows it only with lines", () => {
  const model = { sittings: undefined, projects: [], chains: [], flags: [], items: [], safetyHold: false, baseline: false, profile: "deliberate", suggestions: [], outside: [], needsRule: [] } as never;
  const t = new Proxy({}, { get: (_t, k) => String(k) }) as never;
  const html = renderBoard(model, t, "n", 1, {}, undefined, { heading: "Since <b>", marked: [], lines: [{ text: "App: <script>x</script>", details: ["+ <img>"] }] });
  assert.ok(html.includes("Since &#60;b&#62;"));
  assert.ok(html.includes("&#60;script&#62;x&#60;/script&#62;"));
  assert.ok(!html.includes("<img>"));
  assert.ok(!renderBoard(model, t, "n", 1, {}, undefined, undefined).includes('class="box since"'));
  assert.ok(!renderBoard(model, t, "n", 1, {}, undefined, { heading: "h", marked: [], lines: [] }).includes('class="box since"'));
});

test("an open document that could not be read keeps its blocker and is not cleared", () => {
  const seen = digestOf(board(project("no-go", [item("A", "amber", true)])), 1);
  const unread = { ...item("A", "amber", false), severity: undefined };
  const now = digestOf(board(project("unverified", [unread])), 2, seen);
  assert.deepEqual(Object.values(now.projects.app.blockers), ["A"]);
  assert.deepEqual(diffSeen(seen, now)?.changes[0].cleared ?? [], []);
});

test("an unread document that was not a blocker is not invented as one", () => {
  const seen = digestOf(board(project("unverified", [])), 1);
  const now = digestOf(board(project("unverified", [{ ...item("B", "amber"), severity: undefined }])), 2, seen);
  assert.deepEqual(now.projects.app.blockers, {});
});

test("a read document that is no longer a blocker still counts as cleared", () => {
  const seen = digestOf(board(project("no-go", [item("A", "amber", true)])), 1);
  const now = digestOf(board(project("unverified", [{ ...item("A", "amber", false), severity: "low" }])), 2, seen);
  assert.deepEqual(diffSeen(seen, now)?.changes[0].cleared, ["A"]);
});

test("a moved document (same title gone and new) is not reported", () => {
  const seen = digestOf(board(project("no-go", [item("A")])), 1);
  const moved = { ...item("A"), path: "bugs/sub/A.md" };
  assert.equal(diffSeen(seen, digestOf(board(project("no-go", [moved])), 2, seen)), undefined);
  const more = digestOf(board(project("no-go", [moved, item("N")])), 2, seen);
  assert.deepEqual(diffSeen(seen, more)?.changes[0].added, ["N"]);
  assert.deepEqual(diffSeen(seen, more)?.changes[0].cleared, []);
});

test("projects, paths and titles are capped in the record and when reading it back", () => {
  const many = Array.from({ length: MAX_PROJECTS + 5 }, (_, i) => project("go", [], `p${i}`));
  assert.equal(Object.keys(digestOf(board(...many), 0).projects).length, MAX_PROJECTS);
  const long = { ...item("A"), path: "x".repeat(400) };
  const rec = digestOf(board(project("no-go", [long])), 0);
  assert.ok(Object.keys(rec.projects.app.blockers).every((k) => k.length <= 200));
  const raw = { version: 1, at: 1, projects: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, { name: "n", light: "go", blockers: { ["k".repeat(500)]: "t" } }])) };
  const back = readSeen(raw)!;
  assert.equal(Object.keys(back.projects).length, MAX_PROJECTS);
  assert.ok(Object.keys(back.projects.p0.blockers).every((k) => k.length <= 200));
});

// ---- standup and since-yesterday reports ----

function withReports(light: BoardProject["light"], signals: Array<{ kind: "standup" | "delta"; count: number; at: number }>): BoardProject {
  const p = project(light, []);
  p.health = { lint: "missing", tests: "missing", lintDetail: "", testsDetail: "", clean: false, signals: signals.map((s) => ({ kind: s.kind, result: "pass" as const, count: s.count, at: s.at, detail: "" })) };
  return p;
}

test("a new standup report is a change, worded with its count", () => {
  const seen = digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 100 }])), 150);
  const now = digestOf(board(withReports("go", [{ kind: "standup", count: 7, at: 200 }, { kind: "delta", count: 4, at: 210 }])), 300, seen);
  const d = diffSeen(seen, now);
  assert.deepEqual(d?.changes[0].reports, [{ kind: "standup", count: 7 }, { kind: "delta", count: 4 }]);
  assert.deepEqual(d?.changes[0].added, []);
  assert.deepEqual(sinceLines(d!, labels, 5), [{ text: "App: standup digest: 7 commits, since yesterday: 4 commits", name: "App", details: [] }]);
});

test("the same report seen again is not new, and an older one never is", () => {
  const seen = digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 200 }])), 250);
  assert.equal(diffSeen(seen, digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 200 }])), 300, seen)), undefined);
  assert.equal(diffSeen(seen, digestOf(board(withReports("go", [{ kind: "standup", count: 9, at: 100 }])), 300, seen)), undefined);
});

test("a report that cannot be read this time is kept in the record, so it comes back as seen", () => {
  const seen = digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 200 }])), 250);
  const gone = digestOf(board(withReports("go", [])), 260, seen);
  assert.deepEqual(gone.projects.app.reports, { standup: { at: 200, count: 3 } });
  assert.equal(diffSeen(gone, digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 200 }])), 270, gone)), undefined);
});

test("a report with no commits, and a record from before reports were read, work", () => {
  const empty = digestOf(board(withReports("go", [{ kind: "standup", count: 0, at: 100 }])), 150);
  assert.equal(empty.projects.app.reports, undefined);
  const old = readSeen({ version: 1, at: 5, projects: { app: { name: "App", light: "go", blockers: {} } } });
  assert.ok(old);
  assert.equal(old.projects.app.reports, undefined);
  assert.equal(diffSeen(old, digestOf(board(withReports("go", [{ kind: "delta", count: 2, at: 100 }])), 300))?.changes[0].reports[0].count, 2);
});

test("records with reports compare by their times and counts, and survive a round trip", () => {
  const a = digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 100 }])), 1);
  const b = digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 100 }])), 2);
  const c = digestOf(board(withReports("go", [{ kind: "standup", count: 3, at: 101 }])), 2);
  assert.deepEqual(readSeen(JSON.parse(JSON.stringify(a))), a);
  const broken = JSON.parse(JSON.stringify(a));
  broken.projects.app.reports.standup.count = "x";
  broken.projects.app.reports.other = { at: 1, count: 1 };
  assert.equal(readSeen(broken)?.projects.app.reports, undefined);
});

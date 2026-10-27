import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardItem, BoardProject } from "../../board/boardModel";
import { emptyCounts } from "../../board/types";
import { renderBoard } from "../../board/boardHtml";
import { SinceLabels, clampListed, diffSeen, digestOf, readSeen, sinceLines, MAX_RECORDED } from "../../board/sinceLast";

const labels: SinceLabels = {
  newOne: "1 new blocker",
  newMany: "{count} new blockers",
  clearedOne: "1 blocker cleared",
  clearedMany: "{count} blockers cleared",
  lightMoved: "went from {from} to {to}",
  more: "and {count} more",
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
  const html = renderBoard(model, t, "n", 1, {}, undefined, { heading: "Since <b>", lines: [{ text: "App: <script>x</script>", details: ["+ <img>"] }] });
  assert.ok(html.includes("Since &#60;b&#62;"));
  assert.ok(html.includes("&#60;script&#62;x&#60;/script&#62;"));
  assert.ok(!html.includes("<img>"));
  assert.ok(!renderBoard(model, t, "n", 1, {}, undefined, undefined).includes('class="box since"'));
  assert.ok(!renderBoard(model, t, "n", 1, {}, undefined, { heading: "h", lines: [] }).includes('class="box since"'));
});

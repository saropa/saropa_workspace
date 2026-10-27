import { test } from "node:test";
import assert from "node:assert/strict";
import { Light } from "../../board/boardModel";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { TrainProject, buildTrains, parseVersion, trainRows } from "../../board/train";

const p = (id: string, light: Light, dependsOn: string[] = [], version?: string): TrainProject => ({ id, name: id.toUpperCase(), light, dependsOn, folder: `dir_${id}`, version });

test("fewer than two projects make no train", () => {
  assert.deepStrictEqual(buildTrains([], "version"), []);
  assert.deepStrictEqual(buildTrains([p("a", "go")], "version"), []);
});

test("with no dependencies all projects form one train", () => {
  const t = buildTrains([p("a", "go"), p("b", "go")], "folder");
  assert.strictEqual(t.length, 1);
  assert.deepStrictEqual(t[0].members.map((m) => m.id), ["a", "b"]);
});

test("the light is the worst of the members and never greener", () => {
  for (const worst of ["no-go", "unverified"] as Light[]) {
    const t = buildTrains([p("a", "go"), p("b", worst), p("c", "go")], "folder")[0];
    assert.strictEqual(t.light, worst);
    assert.deepStrictEqual(t.heldBy, ["B"]);
  }
  const all = buildTrains([p("a", "go"), p("b", "go")], "folder")[0];
  assert.strictEqual(all.light, "go");
  assert.deepStrictEqual(all.heldBy, []);
  assert.strictEqual(buildTrains([p("a", "go"), p("b", "unverified"), p("c", "no-go")], "folder")[0].light, "no-go");
});

test("a project ships after the projects it depends on", () => {
  const t = buildTrains([p("app", "go", ["db", "web"]), p("db", "go"), p("web", "go", ["db"])], "folder")[0];
  assert.deepStrictEqual(t.members.map((m) => m.id), ["db", "web", "app"]);
  assert.strictEqual(t.cycle, false);
});

test("projects with declared dependencies group only with their connected projects", () => {
  const trains = buildTrains([p("a", "go", ["b"]), p("b", "go"), p("c", "no-go")], "folder");
  assert.strictEqual(trains.length, 1);
  assert.deepStrictEqual(trains[0].members.map((m) => m.id), ["b", "a"]);
  assert.strictEqual(trains[0].light, "go");
});

test("a circle is flagged and keeps the input order", () => {
  const t = buildTrains([p("a", "go", ["b"]), p("b", "go", ["a"])], "folder")[0];
  assert.strictEqual(t.cycle, true);
  assert.deepStrictEqual(t.members.map((m) => m.id), ["a", "b"]);
});

test("unknown dependencies and self dependencies are ignored", () => {
  const t = buildTrains([p("a", "go", ["a", "zzz"]), p("b", "go")], "folder");
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].cycle, false);
});

test("naming: version when wanted and known, else the folder", () => {
  const projects = [p("db", "go", [], "1.0.0"), p("app", "go", ["db"], "2026.1025.03")];
  assert.strictEqual(buildTrains(projects, "version")[0].name, "APP 2026.1025.03");
  assert.deepStrictEqual(buildTrains(projects, "version")[0].members.map((m) => m.label), ["1.0.0", "2026.1025.03"]);
  assert.strictEqual(buildTrains(projects, "folder")[0].name, "dir_app");
  assert.strictEqual(buildTrains([p("db", "go"), p("app", "go", ["db"])], "version")[0].name, "dir_app");
});

test("parseVersion reads package.json and pubspec.yaml", () => {
  assert.strictEqual(parseVersion("package.json", '{"version":"2.1.0"}'), "2.1.0");
  assert.strictEqual(parseVersion("pubspec.yaml", "name: x\nversion: 1.2.3+45\n"), "1.2.3");
  assert.strictEqual(parseVersion("pubspec.yaml", "version: '2026.1025.03' # note"), "2026.1025.03");
  assert.strictEqual(parseVersion("package.json", "{not json"), undefined);
  assert.strictEqual(parseVersion("package.json", '{"version":"<b>x</b>"}'), undefined);
  assert.strictEqual(parseVersion("package.json", '{"version":3}'), undefined);
  assert.strictEqual(parseVersion("notes.txt", "version: 1.0.0"), undefined);
});

test("rows carry the light word, the order and the held-back note", () => {
  const t = buildTrains([p("db", "no-go"), p("app", "go", ["db"])], "folder");
  const [row] = trainRows(t, { title: "Train {name}", light: { "no-go": "NO-GO", unverified: "UNVERIFIED", go: "GO" }, heldBy: "Held by {names}", cycle: "circle" });
  assert.strictEqual(row.light, "no-go");
  assert.strictEqual(row.name, "Train dir_app");
  assert.strictEqual(row.description, "NO-GO · DB > APP");
  assert.ok(row.tooltip.includes("Held by DB"));
});

test("a circle keeps its place: projects before and after it are ordered", () => {
  const t = buildTrains(
    [p("web", "go", ["a"]), p("a", "go", ["b", "base"]), p("b", "go", ["a"]), p("base", "go")],
    "folder"
  )[0];
  assert.strictEqual(t.cycle, true);
  assert.deepStrictEqual(t.members.map((m) => m.id), ["base", "a", "b", "web"]);
});

test("dependsOn may name a project by display name or folder name", () => {
  const t = buildTrains([p("app", "go", ["DB"]), p("db", "go"), p("x", "go", ["dir_app"])], "folder");
  assert.strictEqual(t.length, 1);
  assert.deepStrictEqual(t[0].members.map((m) => m.id), ["db", "app", "x"]);
  const none = buildTrains([p("a", "go", ["nothing"]), p("b", "go")], "folder");
  assert.deepStrictEqual(none[0].members.map((m) => m.id), ["a", "b"]);
});

test("trains with the same name get different keys", () => {
  const same = (id: string): TrainProject => ({ ...p(id, "go"), folder: "same" });
  const trains = buildTrains([same("a"), { ...same("b"), dependsOn: ["a"] }, same("c"), { ...same("d"), dependsOn: ["c"] }], "folder");
  assert.strictEqual(trains.length, 2);
  assert.strictEqual(trains[0].name, trains[1].name);
  assert.notStrictEqual(trains[0].key, trains[1].key);
  const rows = trainRows(trains, { title: "{name}", light: { "no-go": "N", unverified: "U", go: "G" }, heldBy: "", cycle: "" });
  assert.notStrictEqual(rows[0].key, rows[1].key);
});

test("a hostile project name is escaped in the rendered train row", () => {
  const evil = '<img src=x onerror=alert(1)>"';
  const cfg = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "a", name: evil, path: "a", roots: [], ruleSets: [] }, { id: "b", name: "B", path: "b", roots: [], ruleSets: [] }] };
  const model = buildBoard(cfg, [], undefined, true);
  const trains = buildTrains([{ ...p("a", "go"), name: evil, version: "1.0.0" }, p("b", "go")], "version");
  const strings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "trainTitle" ? "Train {name}" : `[${k}]`) });
  const html = renderBoard(model, strings, "n", 0, {}, undefined, undefined, trains);
  assert.ok(html.includes("vd train"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&#60;img"));
});

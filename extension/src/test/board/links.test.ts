// Linkages (Needs: lines), chains and groups.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNeeds, readFacts } from "../../board/docFacts";
import { buildChains, resolveLinks } from "../../board/links";
import { buildGroups, GroupInput } from "../../board/groups";
import { Classified, ProjectDef } from "../../board/types";

test("parseNeeds: paths, links, project prefixes and separators", () => {
  const body = [
    "Needs: docs/PLAN_A.md, [Other plan](../x/PLAN_B.md); supabase:db-access/run.sql and `PLAN_C.md`.",
    "**Needs:** PLAN_D.md",
    "- needs: PLAN_A.md",
    "Not a line: needs of the many",
  ].join("\n");
  assert.deepEqual(parseNeeds(body), ["docs/PLAN_A.md", "../x/PLAN_B.md", "supabase:db-access/run.sql", "PLAN_C.md", "PLAN_D.md", "PLAN_A.md"]);
  assert.deepEqual(readFacts("# T\nNeeds: A.md", "a.md").needs, ["A.md"]);
  assert.deepEqual(readFacts("```\nNeeds: A.md\n```", "a.md").needs, [], "inside code it is not a Needs line");
});

const projects: ProjectDef[] = [
  { id: "app", name: "App", path: "app", roots: [], ruleSets: [] },
  { id: "db", name: "Supabase", path: "db", roots: [], ruleSets: [] },
];
const row = (project: string, path: string, status: Classified["status"]): Classified => ({ project, path, status, kind: "", note: "" });

test("links resolve by path, file name, project prefix, and report missing, ambiguous and done", () => {
  const rows = [
    row("app", "docs/PLAN_A.md", "amber"),
    row("app", "docs/old/PLAN_DONE.md", "green"),
    row("app", "docs/x/DUP.md", "amber"),
    row("app", "docs/y/DUP.md", "amber"),
    row("db", "db-access/run.sql", "red"),
    row("db", "docs/PLAN_A.md", "amber"),
  ];
  const needs = new Map<string, string[]>([
    ["app\tdocs/B.md", ["PLAN_A.md", "PLAN_DONE.md", "DUP.md", "nothing.md", "Supabase:db-access/run.sql", "../PLAN_A.md"]],
  ]);
  const links = resolveLinks(rows, needs, projects);
  const by = (t: string) => links.find((l) => l.target === t)!;
  assert.equal(by("PLAN_A.md").toProject, "app", "same project wins over the other project's file of the same name");
  assert.equal(by("PLAN_A.md").state, "open");
  assert.equal(by("PLAN_DONE.md").state, "done");
  assert.equal(by("DUP.md").state, "ambiguous");
  assert.equal(by("nothing.md").state, "missing");
  assert.equal(by("Supabase:db-access/run.sql").toProject, "db");
});

test("chains run first-to-do first, across projects, and survive a cycle", () => {
  const l = (fp: string, fpath: string, tp: string, tpath: string) => ({
    fromProject: fp, fromPath: fpath, target: tpath, state: "open" as const, toProject: tp, toPath: tpath,
  });
  const chains = buildChains([
    l("db", "sql.sql", "app", "build.md"), // the SQL waits on the build
    l("web", "store.md", "db", "sql.sql"), // the store plan waits on the SQL
  ]);
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0].map((n) => n.path), ["build.md", "sql.sql", "store.md"]);
  const loop = buildChains([l("a", "x.md", "a", "y.md"), l("a", "y.md", "a", "x.md")]);
  assert.equal(loop.length, 1, "a cycle is listed once, not hidden and not looped");
});

function item(project: string, path: string, over: Partial<GroupInput> = {}): GroupInput {
  return { key: project + "\t" + path, project, path, words: 500, docRefs: 0, sourceFiles: [], ...over };
}

test("groups: same prefix, shared files, and a hub that joins nothing", () => {
  const items = [
    item("app", "bugs/OWNER_A.md"),
    item("app", "bugs/OWNER_B.md"),
    item("app", "bugs/20261026_HANDOVER_X.md", { sourceFiles: ["lib/a.dart", "lib/b.dart"] }),
    item("app", "bugs/HANDOVER_Y.md", { sourceFiles: ["lib/a.dart", "lib/b.dart"] }),
    item("app", "bugs/LAUNCH_TEST.md", { words: 120000, docRefs: 35, sourceFiles: ["lib/a.dart", "lib/b.dart"] }),
    item("db", "db-access/emergency_one.sql"),
    item("db", "db-access/emergency_two.sql"),
    item("db", "db-access/single.sql"),
  ];
  const g = buildGroups(items);
  assert.equal(g.groupOf.get("app\tbugs/OWNER_A.md")?.name, "Owner documents");
  assert.equal(g.groupOf.get("app\tbugs/OWNER_B.md")?.name, "Owner documents");
  assert.equal(g.groupOf.get("app\tbugs/HANDOVER_Y.md")?.name, "Handover documents");
  assert.equal(g.groupOf.get("db\tdb-access/emergency_one.sql")?.name, "Emergency documents");
  assert.equal(g.groupOf.get("db\tdb-access/single.sql")?.name, undefined, "a single document is not a group");
  assert.ok(g.hubs.has("app\tbugs/LAUNCH_TEST.md"));
  assert.equal(g.groupOf.get("app\tbugs/LAUNCH_TEST.md")?.name, undefined, "the hub joined no group");
  assert.notEqual(g.groupOf.get("app\tbugs/OWNER_A.md")?.name, g.groupOf.get("app\tbugs/HANDOVER_Y.md")?.name);
});

test("groups: shared source files join differently named documents; manual groups and ungrouped win", () => {
  const items = [
    item("app", "docs/ONE.md", { sourceFiles: ["lib/a.dart", "lib/b.dart", "lib/c.dart"] }),
    item("app", "docs/TWO.md", { sourceFiles: ["lib/a.dart", "lib/b.dart"] }),
    item("app", "docs/THREE.md", { sourceFiles: ["lib/a.dart"] }),
    item("app", "docs/MAN_1.md"),
    item("app", "docs/MAN_2.md"),
  ];
  const g = buildGroups(items, { manual: [{ name: "Custom", match: ["app/docs/MAN_*.md"] }], ungrouped: ["app/docs/TWO.md"] });
  assert.equal(g.groupOf.get("app\tdocs/ONE.md")?.name, undefined, "TWO was pulled out, so ONE is alone");
  assert.equal(g.groupOf.get("app\tdocs/MAN_1.md")?.name, "Custom");
  const g2 = buildGroups(items);
  assert.equal(g2.groupOf.get("app\tdocs/ONE.md")?.name, "Related documents");
  assert.equal(g2.groupOf.get("app\tdocs/THREE.md")?.name, undefined, "one shared file is not enough");
});

// Characterization of buildOrg and resetOrgCache: the shape of the built organization for 0, 1 and many
// documents, ungrouped globs, a changed rules-file group, and the cache reset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrg, resetOrgCache } from "../../board/boardOrg";
import { BoardConfig, Classified } from "../../board/types";

const web = { id: "web", name: "Web", path: "web", roots: [], ruleSets: [] };
const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
const row = (path: string, status: Classified["status"] = "amber", project = "app"): Classified => ({ project, path, status, kind: "", note: "" });
const many = (n: number): Classified[] => Array.from({ length: n }, (_v, k) => row(`docs/area${k % 5}/sub${k % 3}/PLAN_item${k}.md`));
const plain = (b: ReturnType<typeof buildOrg>): unknown => ({ groupOf: [...b.groupOf].sort((a, c) => (a[0] < c[0] ? -1 : 1)), hubs: [...b.hubs].sort(), layouts: b.layouts });

test("buildOrg: no documents give no groups, no hubs and no layouts", () => {
  resetOrgCache();
  const b = buildOrg([], undefined, cfg, []);
  assert.equal(b.groupOf.size, 0);
  assert.equal(b.hubs.size, 0);
  assert.deepEqual(b.layouts, {});
});

test("buildOrg: one document has a layout without headers and no group", () => {
  resetOrgCache();
  const b = buildOrg([row("docs/a.md")], undefined, cfg, []);
  assert.equal(b.groupOf.size, 0);
  assert.deepEqual(Object.keys(b.layouts), ["app"]);
  assert.equal(b.layouts.app.band, 0);
  assert.equal(b.layouts.app.headers, false);
});

test("buildOrg: many documents give group views with parents, and one layout for every project", () => {
  resetOrgCache();
  const rows = [...many(60), ...Array.from({ length: 6 }, (_v, k) => row(`site/p${k}.md`, "green", "web"))];
  const b = buildOrg(rows, undefined, { ...cfg, projects: [...cfg.projects, web] }, []);
  assert.equal(b.layouts.app, b.layouts.web);
  assert.equal(b.layouts.app.band, 2);
  assert.equal(b.groupOf.size, 66);
  const view = b.groupOf.get("app\tdocs/area0/sub0/PLAN_item0.md")!;
  assert.ok(view.name !== "" && view.emoji && view.colour?.startsWith("#") && view.why !== "");
  assert.equal(b.groupOf.get("web\tsite/p0.md")!.name, "Site");
});

test("buildOrg: finished documents count, and ungrouped globs do not", () => {
  resetOrgCache();
  const rows = [...many(10), row("done/x.md", "green"), row("skip/y.md", "red")];
  const all = buildOrg(rows, undefined, cfg, []);
  assert.equal(all.layouts.app.band, 1);
  resetOrgCache();
  const kept = buildOrg(rows, undefined, { ...cfg, ungrouped: ["app/skip/**"] }, []);
  assert.deepEqual(Object.keys(kept.layouts), ["app"]);
  assert.ok(!kept.groupOf.has("app\tskip/y.md"));
});

test("buildOrg: a changed rules-file group changes the answer, and a reset gives the same answer again", () => {
  resetOrgCache();
  const rows = many(12);
  const first = buildOrg(rows, undefined, cfg, []);
  const named = buildOrg(rows, undefined, { ...cfg, groups: [{ name: "Hand", match: ["app/docs/area0/**"] }] }, []);
  assert.ok([...named.groupOf.values()].some((g) => g.byUser && g.name === "Hand"));
  assert.ok(![...first.groupOf.values()].some((g) => g.byUser));
  resetOrgCache();
  assert.deepEqual(plain(buildOrg(rows, undefined, cfg, [])), plain(first));
});

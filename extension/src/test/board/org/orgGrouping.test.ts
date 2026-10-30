// Auto-grouping on the folder shapes of the design: flat, prefixed, numbered, deep, monorepo, huge, scattered.

import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFor } from "../../../board/org/layout";
import { displayName } from "../../../board/org/naming";
import { OrgDoc, OrgResult } from "../../../board/org/orgTypes";
import { byId, checkProperties, doc, docs, run, t } from "./orgFixtures";

test("tiny-flat: 5 documents form no visible headers", () => {
  const input = docs("app", ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md", "docs/e.md"]);
  const r = run(input);
  assert.equal(layoutFor(5).headers, false);
  assert.equal(layoutFor(5).rowLimit, null);
  checkProperties(r, input);
  assert.ok(r.groups.length <= 1);
});

test("prefix-flat: kind words are skipped and stems form groups", () => {
  const stems = ["share", "sync", "export", "login", "theme", "backup"];
  const kinds = ["PLAN", "BUG", "SPEC", "DRAFT", "REPORT"];
  const input = docs("app", stems.flatMap((s) => kinds.map((k) => `docs/${k}_${s}.md`)));
  const r = run(input);
  checkProperties(r, input);
  assert.equal(r.groups.length, 6);
  assert.ok(r.groups.every((g) => g.kind === "stem" && g.total === 5));
  assert.ok(byId(r, "app:stem:docs/share"));
  assert.equal(byId(r, "app:stem:docs/share")?.name, "Share");
  assert.equal(r.groupOf.size, 30);
});

test("sequences: numbered families join at two members and carry their range", () => {
  const input = docs("app", [
    ...[1, 2, 3, 4].map((n) => `docs/plans/share_keys_phase${n}.md`),
    "docs/plans/api_v1.md",
    "docs/plans/api_v2.md",
    "docs/plans/notes_part-a.md",
    "docs/plans/notes_part-b.md",
    "docs/plans/gap_phase1.md",
    "docs/plans/gap_phase3.md",
    "docs/plans/solo.md",
    "docs/plans/other_thing.md",
  ]);
  const r = run(input);
  checkProperties(r, input);
  const share = byId(r, "app:seq:docs/plans/share_keys")!;
  assert.equal(share.total, 4);
  assert.deepEqual(share.range, { label: "phase", from: 1, to: 4 });
  assert.equal(displayName(share, t), "Share keys · phases 1-4");
  assert.equal(displayName(byId(r, "app:seq:docs/plans/api")!, t), "API · versions 1-2");
  assert.deepEqual(byId(r, "app:seq:docs/plans/gap")!.range, { label: "phase", from: 1, to: 3 });
  assert.deepEqual(byId(r, "app:seq:docs/plans/notes")!.range, { label: "part", from: 1, to: 2 });
  assert.equal(r.groupOf.has("app\tdocs/plans/solo.md"), false);
});

test("deep-tree: status and date folders never form groups, two levels at most", () => {
  const input: OrgDoc[] = [];
  let n = 0;
  for (let a = 0; a < 5; a++) {
    for (let s = 0; s < 4; s++) {
      for (let f = 0; f < 5; f++) {
        for (let i = 0; i < 5; i++) {
          const extra = i === 0 ? "/done" : i === 1 ? "/archive" : i === 2 ? "/2025/10" : i === 3 ? "/wip" : "";
          input.push(doc("app", `docs/area${a}/sub${s}/feat${f}${extra}/zq${n++}.md`));
        }
      }
    }
  }
  const r = run(input);
  checkProperties(r, input);
  assert.equal(input.length, 500);
  assert.equal(r.groupOf.size, 500);
  assert.ok(!r.groups.some((g) => /(^|\/)(done|archive|wip|2025|10)(\/|$)/.test(g.folder)));
  assert.ok(!r.groups.some((g) => /done|archive/i.test(g.name)));
  assert.equal(r.groups.filter((g) => !g.parent).length, 5);
  assert.equal(r.groups.filter((g) => g.parent).length, 20);
});

test("monorepo: the same folders in three projects stay three sets of groups", () => {
  const input = ["web", "app", "db"].flatMap((p) => docs(p, ["docs/plans/payments/a_x.md", "docs/plans/payments/b_y.md", "docs/plans/payments/c_z.md", "docs/bugs/payments/d_q.md", "docs/bugs/payments/e_r.md"]));
  const r = run(input);
  checkProperties(r, input);
  for (const p of ["web", "app", "db"]) {
    const mine = r.groups.filter((g) => g.project === p);
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((g) => g.members.every((m) => m.startsWith(p + "\t"))));
  }
  const names = r.groups.filter((g) => g.project === "app").map((g) => g.name);
  assert.equal(new Set(names).size, names.length, "names are unique inside a project");
});

test("huge-folder: stems split it, the rest goes to an Other group", () => {
  const input: OrgDoc[] = [];
  for (let s = 0; s < 20; s++) {
    for (let i = 0; i < 5; i++) {
      input.push(doc("app", `docs/topic${String.fromCharCode(97 + s)}x_part${i}z.md`));
    }
  }
  for (let i = 0; i < 300; i++) {
    input.push(doc("app", `docs/solo${i}q.md`));
  }
  const r = run(input);
  checkProperties(r, input);
  const other = r.groups.find((g) => g.kind === "other")!;
  assert.equal(other.oversize, true);
  assert.ok(other.total >= 300);
  assert.equal(r.groups.filter((g) => g.kind === "seq" || g.kind === "stem").length, 20);
});

test("scatter: 60 folders of one document never make a group of one", () => {
  const input = Array.from({ length: 60 }, (_v, i) => doc("app", `area${i}/zz${i}.md`));
  const r = run(input);
  checkProperties(r, input);
  assert.equal(r.groups.filter((g) => g.kind === "folder").length, 0);
});

test("a group id does not change when a member is added or removed", () => {
  const base = docs("app", ["docs/pay/a_one.md", "docs/pay/b_two.md", "docs/pay/c_three.md", "docs/misc/zz1.md", "docs/misc/zz2.md"]);
  const more = [...base, doc("app", "docs/pay/d_four.md")];
  const less = base.slice(1);
  const ids = (r: OrgResult): string[] => r.groups.map((g) => g.id).filter((i) => i.includes("pay"));
  assert.deepEqual(ids(run(more)), ids(run(base)));
  assert.deepEqual(ids(run(less)), ids(run(base)));
});

test("files and links: shared source files group documents, a link pulls a loose one in", () => {
  const files = ["src/a.dart", "src/b.dart"];
  const input = [
    doc("app", "docs/p1.md", { sourceFiles: files }),
    doc("app", "docs/p2.md", { sourceFiles: files }),
    doc("app", "docs/p3.md", { needs: ["app\tdocs/p1.md"] }),
    doc("app", "docs/p4.md"),
    doc("app", "docs/p5.md"),
    doc("app", "docs/p6.md"),
    doc("app", "docs/p7.md"),
    doc("app", "docs/p8.md"),
    doc("app", "docs/p9.md"),
  ];
  const r = run(input);
  checkProperties(r, input);
  const g = r.groups.find((x) => x.kind === "files");
  assert.ok(g);
  assert.ok(g!.members.includes("app\tdocs/p3.md"));
  assert.equal(displayName(g!, t).startsWith("Touches "), true);
});

test("a hub joins its folder group but never pulls documents together by files", () => {
  const shared = ["x.dart", "y.dart"];
  const input = [
    doc("app", "docs/h.md", { sourceFiles: shared, docRefs: 50 }),
    doc("app", "docs/a.md", { sourceFiles: shared }),
    ...Array.from({ length: 9 }, (_v, i) => doc("app", `docs/q${i}.md`)),
  ];
  const r = run(input);
  assert.ok(!r.groups.some((g) => g.kind === "files"));
  assert.ok(r.hubs.has("app\tdocs/h.md"));
});

test("the same documents in any order give the same result", () => {
  const input = docs("app", Array.from({ length: 40 }, (_v, i) => `docs/f${i % 4}/pay${i % 3}_item${i}.md`));
  const a = run(input);
  const b = run([...input].reverse());
  assert.equal(JSON.stringify(a.groups), JSON.stringify(b.groups));
});

// Review fixes of the auto-organization engine: stable ids, names, colours, links, splits, paths, scale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFor, maxFor } from "../../../board/org/layout";
import { cleanName, dedupNames } from "../../../board/org/naming";
import { mergeDictionary } from "../../../board/org/tags";
import { isDateSegment, logicalFolders, stemWord } from "../../../board/org/tokens";
import { OrgDoc, OrgResult } from "../../../board/org/orgTypes";
import { assertScales, byId, checkProperties, doc, docs, generated, run } from "./orgFixtures";

const idsWith = (r: OrgResult, part: string): string[] => r.groups.map((g) => g.id).filter((i) => i.includes(part));

test("MAX is kept within 10 percent of the previous run", () => {
  assert.equal(maxFor(106, 20), 20);
  assert.equal(maxFor(106), 21);
  assert.equal(maxFor(400, 20), 40);
  assert.equal(layoutFor(106, undefined, 20).max, 20);
});

test("one unrelated document more or less never changes group ids, across every MAX boundary", () => {
  const pay = [
    ...Array.from({ length: 10 }, (_v, i) => doc("app", `docs/pay/sub0/p${i}.md`)),
    ...Array.from({ length: 10 }, (_v, i) => doc("app", `docs/pay/sub1/q${i}.md`)),
  ];
  const build = (n: number): OrgDoc[] => [...pay, ...Array.from({ length: n - 20 }, (_v, i) => doc("app", `docs/fill/f${i}.md`))];
  let flips = 0;
  for (let n = 60; n < 190; n++) {
    const base = run(build(n));
    for (const m of [n - 1, n + 1]) {
      assert.deepEqual(idsWith(run(build(m), { previous: base.layouts }), "pay"), idsWith(base, "pay"), `N ${n} to ${m}`);
    }
    if (idsWith(run(build(n + 1)), "pay").join() !== idsWith(base, "pay").join()) {
      flips += 1;
    }
  }
  assert.ok(flips >= 1, "the fixture crosses a boundary where ids would flip without the previous layout");
});

test("files groups: two clusters whose top file is index.ts get different ids, and an added document keeps the id", () => {
  const cluster = (dir: string, names: string[]): OrgDoc[] => names.map((n) => doc("app", `docs/${n}.md`, { sourceFiles: [`${dir}/index.ts`, `${dir}/util.ts`] }));
  const filler = Array.from({ length: 6 }, (_v, i) => doc("app", `docs/z${i}q.md`));
  const base = [...cluster("a", ["alpha", "bravo"]), ...cluster("b", ["delta", "foxtrot"]), ...filler];
  const r = run(base);
  checkProperties(r, base);
  const files = r.groups.filter((g) => g.kind === "files");
  assert.equal(files.length, 2);
  assert.equal(new Set(files.map((g) => g.id)).size, 2);
  assert.equal(new Set(files.map((g) => g.name)).size, 2, "the equal names are told apart");
  assert.ok(files.every((g) => g.name.startsWith("index.ts")));
  const more = run([...base, ...cluster("a", ["hotel"])]);
  assert.deepEqual(more.groups.filter((g) => g.kind === "files").map((g) => g.id), files.map((g) => g.id));
});

test("names: iOS stays, nothing left is empty, a taken number is skipped", () => {
  assert.equal(cleanName("iOS"), "iOS");
  assert.equal(cleanName("iOS_sync"), "iOS sync");
  assert.equal(cleanName("shareKeys"), "Share keys");
  assert.equal(cleanName("v2"), "");
  const out = dedupNames([
    { id: "a:folder:x/foo", name: "Foo", kind: "folder", folder: "x/foo" },
    { id: "a:folder:y/foo", name: "Foo", kind: "folder", folder: "x/foo" },
    { id: "a:folder:z/foo", name: "Foo", kind: "folder", folder: "x/foo" },
    { id: "a:folder:w/foo2", name: "Foo 2", kind: "folder", folder: "w/foo2" },
  ]);
  assert.equal(new Set(out.values()).size, 4);
  assert.deepEqual([out.get("a:folder:x/foo"), out.get("a:folder:y/foo"), out.get("a:folder:z/foo")], ["Foo", "Foo 3", "Foo 4"]);
});

test("a folder named only v2 still gets a name", () => {
  const input = docs("app", [...Array.from({ length: 3 }, (_v, i) => `docs/v2/q${i}.md`), ...Array.from({ length: 6 }, (_v, i) => `docs/z${i}x.md`)]);
  const r = run(input);
  assert.ok(r.groups.every((g) => g.name !== ""));
});

test("sequence families: the most common label names the family; a hub does not join", () => {
  const input = [...docs("app", ["docs/gap_phase1.md", "docs/gap_phase2.md", "docs/gap_part3.md", "docs/api_v1.md", "docs/api_v2.md", ...Array.from({ length: 6 }, (_v, i) => `docs/z${i}x.md`)])];
  input[3] = doc("app", "docs/api_v1.md", { words: 30000 });
  const r = run(input);
  const gap = byId(r, "app:seq:docs/gap")!;
  assert.deepEqual(gap.range, { label: "phase", from: 1, to: 2 });
  assert.equal(r.groupOf.get("app\tdocs/gap_part3.md") === gap.id, false);
  assert.equal(byId(r, "app:seq:docs/api"), undefined);
});

test("custom colours: readable on white and dark, and no red however pale", () => {
  const colours = ["#ffcccc", "#9c7c7c", "#ffff00", "#101010", "#1a7fb0"];
  const m = mergeDictionary({ add: colours.map((c, i) => ({ id: "c" + i, label: "C", emoji: "🚀", colour: c, patterns: ["x" + i] })) });
  assert.deepEqual(m.refused.map((x) => x.id), ["c0", "c1", "c2", "c3"]);
});

test("tokens: fixed stems to fix, 1080 is not a date, 2025 is, an unknown front matter tag is reported", () => {
  assert.equal(stemWord("fixed"), stemWord("fix"));
  assert.equal(isDateSegment("1080"), false);
  assert.equal(isDateSegment("4096"), false);
  assert.equal(isDateSegment("2025"), true);
  assert.equal(isDateSegment("2025-10"), true);
  assert.deepEqual(logicalFolders("docs/1080/a.md"), ["docs", "1080"]);
  assert.deepEqual(logicalFolders("docs/2025/a.md"), ["docs"]);
  const d = doc("app", "docs/a.md", { tags: ["nonsense", "payments"] });
  assert.deepEqual(run([d]).unknownTags, [{ key: d.key, tag: "nonsense" }]);
});

test("links: a loose root document joins the folder group made at a lower level", () => {
  const input = [
    ...docs("app", ["docs/pay/a1.md", "docs/pay/a2.md", "docs/pay/a3.md"]),
    doc("app", "topq.md", { needs: ["app\tdocs/pay/a1.md", "app\tdocs/pay/a2.md"] }),
    ...docs("app", Array.from({ length: 6 }, (_v, i) => `zz${i}y.md`)),
  ];
  const r = run(input);
  checkProperties(r, input);
  assert.equal(r.groupOf.get("app\ttopq.md"), "app:folder:docs/pay");
});

test("a stem group over MAX is split by the next stem word; one that cannot be split is flagged", () => {
  const topics = ["keys", "sync", "login", "theme", "cache"];
  const input = docs("app", topics.flatMap((t) => Array.from({ length: 6 }, (_v, i) => `docs/share_${t}_a${i}.md`)));
  const r = run(input);
  checkProperties(r, input);
  const stems = r.groups.filter((g) => g.kind === "stem");
  assert.equal(stems.length, 5);
  assert.ok(stems.every((g) => g.total === 6 && !g.oversize));
  assert.ok(byId(r, "app:stem:docs/share+keys"));
  const flat = docs("app", Array.from({ length: 30 }, (_v, i) => `docs/share_q${i}x.md`));
  const f = run(flat);
  const g = f.groups.find((x) => x.kind === "stem")!;
  assert.equal(g.oversize, true);
  assert.equal(g.why.key, "releaseBoard.org.why.oversize");
});

test("Windows paths group like slash paths", () => {
  const paths = ["docs/pay/a1.md", "docs/pay/a2.md", "docs/pay/a3.md", ...Array.from({ length: 6 }, (_v, i) => `docs/zz${i}y.md`)];
  const slash = run(docs("app", paths));
  const back = run(docs("app", paths.map((p) => p.replace(/\//g, "\\"))));
  assert.deepEqual(back.groups.map((g) => [g.id, g.total, g.name]), slash.groups.map((g) => [g.id, g.total, g.name]));
});

test("scale: 2,000 documents in one project use MIN 5 and a row limit of 3", () => {
  assertScales((n) => generated(n, 1), (d) => void run(d));
  const input = generated(2000, 1);
  const r = run(input);
  checkProperties(r, input);
  assert.equal(r.layouts.app.min, 5);
  assert.equal(layoutFor(2000).rowLimit, 3);
  assert.ok(r.groups.length > 20);
});

test("realistic names: shared topic words form stem groups", () => {
  const topics = ["payments", "sync", "login", "theme"];
  const kinds = ["PLAN", "BUG", "SPEC"];
  const tails = ["refunds", "limits", "retry", "audit", "export"];
  const input = docs("app", topics.flatMap((t) => kinds.flatMap((k) => tails.map((x) => `docs/${k}_${t}_${x}.md`))));
  const r = run(input);
  checkProperties(r, input);
  const stems = r.groups.filter((g) => g.kind === "stem");
  assert.equal(stems.length, 4);
  assert.ok(stems.every((g) => g.total === 15));
});

test("renaming one file keeps every group id", () => {
  const paths = ["docs/pay/a_one.md", "docs/pay/b_two.md", "docs/pay/c_three.md", "docs/share_keys_phase1.md", "docs/share_keys_phase2.md", ...Array.from({ length: 6 }, (_v, i) => `docs/zz${i}y.md`)];
  const before = run(docs("app", paths));
  const renamed = paths.map((p) => (p === "docs/pay/b_two.md" ? "docs/pay/b_deux.md" : p === "docs/share_keys_phase2.md" ? "docs/share_keys_phase3.md" : p));
  const after = run(docs("app", renamed));
  assert.deepEqual(after.groups.map((g) => g.id), before.groups.map((g) => g.id));
});

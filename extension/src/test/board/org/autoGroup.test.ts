// Characterization of the auto-grouping engine through its public organize(), on small fixed document sets:
// folder groups, a sequence family, a split of an over-size stem group, Other, hand-made groups, placements,
// overrides, hubs and stale entries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OrgDoc } from "../../../board/org/orgTypes";
import { doc, docs, run } from "./orgFixtures";

const brief = (r: ReturnType<typeof run>): Array<[string, string, number, string | undefined]> => r.groups.map((g) => [g.id, g.name, g.total, g.parent]);

test("organize: a folder of enough documents is one group, a lone document stays loose", () => {
  const input = [...docs("app", ["pay/a.md", "pay/b.md", "pay/c.md", "pay/d.md"]), doc("app", "other.md")];
  const r = run(input);
  assert.deepEqual(brief(r), [["app:folder:pay", "Pay", 4, undefined]]);
  assert.equal(r.groupOf.get("app\tpay/a.md"), "app:folder:pay");
  assert.equal(r.groupOf.has("app\tother.md"), false);
});

test("organize: nothing, and nothing grouped, give empty results", () => {
  assert.deepEqual(run([]).groups, []);
  assert.equal(run(docs("app", ["a.md", "b.md"])).groups.length, 0);
});

test("organize: in an over-size folder a numbered family, a stem group and Other are made", () => {
  const input: OrgDoc[] = [
    ...docs("app", ["docs/auth_phase_1.md", "docs/auth_phase_2.md", "docs/auth_phase_3.md"]),
    ...["a", "b", "c", "d"].map((x) => doc("app", `docs/search_${x}.md`)),
    ...Array.from({ length: 12 }, (_v, i) => doc("app", `docs/zz${i}q.md`)),
  ];
  const r = run(input);
  const kinds = r.groups.map((g) => g.kind).sort();
  assert.deepEqual(kinds, ["other", "seq", "stem"]);
  assert.equal(r.groups.find((g) => g.kind === "seq")!.range?.to, 3);
  assert.equal(r.groups.find((g) => g.kind === "stem")!.total, 4);
  assert.equal(r.groups.find((g) => g.kind === "other")!.total, 12);
});

test("organize: an over-size stem group is split by the next word", () => {
  const input = ["invoice", "refund", "tax"].flatMap((p) => Array.from({ length: 6 }, (_v, i) => doc("app", `docs/billing_${p}_${i}.md`)));
  const r = run(input);
  const stems = r.groups.filter((g) => g.kind === "stem").map((g) => g.id.split(":")[2]).sort();
  assert.deepEqual(stems, ["docs/billing+invoice", "docs/billing+refund", "docs/billing+tax"]);
});

test("organize: a rules-file group, a placement by hand, an override and a hub", () => {
  const input = [...docs("app", ["pay/a.md", "pay/b.md", "pay/c.md", "misc/ruled.md", "misc/placed.md"]), doc("app", "misc/big.md", { words: 30000 })];
  const r = run(input, { manual: [{ name: "Ruled  group", match: ["app/misc/ruled.md"] }] }, { groups: { "app:folder:pay": { name: "Money", emoji: "💰" } }, assign: [{ project: "app", path: "misc/placed.md", group: "app:folder:pay" }] });
  const pay = r.groups.find((g) => g.id === "app:folder:pay")!;
  assert.equal(pay.name, "Money");
  assert.equal(pay.emoji, "💰");
  assert.equal(pay.edited, true);
  assert.equal(pay.total, 4);
  assert.equal(r.groupOf.get("app\tmisc/placed.md"), "app:folder:pay");
  assert.equal(r.groups.find((g) => g.kind === "manual")!.name, "Ruled group");
  assert.ok(r.hubs.has("app\tmisc/big.md"));
});

test("organize: entries that name nothing are reported as stale", () => {
  const r = run(docs("app", ["a.md"]), {}, { groups: { "app:folder:gone": { name: "Gone" } }, untag: [{ project: "app", path: "missing.md", tag: "x" }], assign: [{ project: "app", path: "a.md", group: "app:folder:nowhere" }] });
  assert.deepEqual(r.stale.map((s) => s.kind).sort(), ["assign", "group", "untag"]);
});

test("organize: the order the documents arrive in does not change the result", () => {
  const input = [...docs("app", ["pay/a.md", "pay/b.md", "pay/c.md", "x/y.md"]), ...Array.from({ length: 8 }, (_v, i) => doc("app", `docs/zz${i}q.md`))];
  assert.deepEqual(run([...input].reverse()).groups, run(input).groups);
});

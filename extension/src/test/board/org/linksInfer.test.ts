// Covers link inference: the pair key, the size-scaled proposal cap, loop detection, and inferLinkProposals through
// its phrase, sequence, stem and mention signals plus rejection, existing links, mutual pairs, caps and ordering.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Link } from "../../../board/links";
import { defaultTotal, inferLinkProposals, proposalKey, wouldCircle } from "../../../board/org/linksInfer";
import type { LinkDoc } from "../../../board/org/linksSignals";

const ld = (project: string, path: string, text = ""): LinkDoc => ({ project, path, title: "", text });
const edge = (fromPath: string, toPath: string, project = "p"): Link => ({ fromProject: project, fromPath, target: toPath, state: "open", toProject: project, toPath });
const graph = (edges: Array<[string, string]>): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  }
  return m;
};

test("proposalKey: joins project and path of both sides with an arrow", () => {
  assert.equal(proposalKey("p", "a.md", "q", "docs/b.md"), "p/a.md->q/docs/b.md");
});

test("defaultTotal: the cap grows with the number of documents in four steps", () => {
  assert.equal(defaultTotal(0), 20);
  assert.equal(defaultTotal(49), 20);
  assert.equal(defaultTotal(50), 50);
  assert.equal(defaultTotal(199), 50);
  assert.equal(defaultTotal(200), 100);
  assert.equal(defaultTotal(999), 100);
  assert.equal(defaultTotal(1000), 200);
});

test("wouldCircle: a document waiting on itself is a loop", () => {
  assert.equal(wouldCircle(new Map(), "a", "a"), true);
});

test("wouldCircle: an empty graph has no loop for distinct documents", () => {
  assert.equal(wouldCircle(new Map(), "a", "b"), false);
});

test("wouldCircle: a direct or indirect return path closes a loop", () => {
  assert.equal(wouldCircle(graph([["b", "a"]]), "a", "b"), true);
  // b waits on c, c waits on a: a -> b would close a three-document loop.
  assert.equal(wouldCircle(graph([["b", "c"], ["c", "a"]]), "a", "b"), true);
});

test("wouldCircle: an unrelated chain is not a loop", () => {
  assert.equal(wouldCircle(graph([["b", "c"], ["c", "d"]]), "a", "b"), false);
});

test("wouldCircle: a loop already in the graph does not hang the search", () => {
  // b and c wait on each other; the visited set must stop the walk.
  assert.equal(wouldCircle(graph([["b", "c"], ["c", "b"]]), "a", "b"), false);
});

test("inferLinkProposals: no documents give no proposals", () => {
  assert.deepEqual(inferLinkProposals([], [], new Set()), []);
});

test("inferLinkProposals: a 'blocked by' phrase naming another document is a high-confidence proposal", () => {
  const r = inferLinkProposals([ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")], [], new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].fromPath, "a.md");
  assert.equal(r[0].toPath, "b.md");
  // The phrase outranks the plain mention of the same file name, so only the phrase is kept for the pair.
  assert.equal(r[0].signal, "phrase");
  assert.equal(r[0].confidence, "high");
  assert.equal(r[0].key, "p/a.md->p/b.md");
  assert.deepEqual(r[0].why, { key: "releaseBoard.linkWhy.phrase", params: { phrase: "blocked by", target: "b.md" } });
});

test("inferLinkProposals: a document naming itself proposes nothing", () => {
  assert.deepEqual(inferLinkProposals([ld("p", "a.md", "Blocked by a.md")], [], new Set()), []);
});

test("inferLinkProposals: a rejected pair is not proposed again", () => {
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")];
  assert.deepEqual(inferLinkProposals(docs, [], new Set(["p/a.md->p/b.md"])), []);
});

test("inferLinkProposals: a pair that already has a resolved link is not proposed", () => {
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")];
  assert.deepEqual(inferLinkProposals(docs, [edge("a.md", "b.md")], new Set()), []);
});

test("inferLinkProposals: an existing link with no resolved target neither blocks nor counts", () => {
  const unresolved: Link = { fromProject: "p", fromPath: "a.md", target: "b.md", state: "missing" };
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")];
  assert.equal(inferLinkProposals(docs, [unresolved], new Set()).length, 1);
});

test("inferLinkProposals: a proposal that would close a loop with an existing link is dropped", () => {
  // b already waits on a, so a waiting on b would be circular.
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")];
  assert.deepEqual(inferLinkProposals(docs, [edge("b.md", "a.md")], new Set()), []);
});

test("inferLinkProposals: two documents naming each other give one proposal, the earlier key", () => {
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md", "Blocked by a.md")];
  const r = inferLinkProposals(docs, [], new Set());
  // Equal strength both ways: the pair collapses to the direction whose key sorts first.
  assert.equal(r.length, 1);
  assert.equal(r[0].key, "p/a.md->p/b.md");
});

test("inferLinkProposals: a mention with no phrase is a low-confidence proposal", () => {
  const r = inferLinkProposals([ld("p", "a.md", "See b.md for background."), ld("p", "b.md")], [], new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].signal, "mention");
  assert.equal(r[0].confidence, "low");
});

test("inferLinkProposals: a phrase naming a document of another project is downgraded one step", () => {
  const r = inferLinkProposals([ld("p", "a.md", "Blocked by b.md"), ld("q", "b.md")], [], new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].toProject, "q");
  // Cross-project evidence is weaker, so high becomes medium.
  assert.equal(r[0].confidence, "medium");
});

test("inferLinkProposals: consecutive phases make the later wait on the earlier at high confidence", () => {
  const r = inferLinkProposals([ld("p", "plan_phase1.md"), ld("p", "plan_phase2.md")], [], new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].fromPath, "plan_phase2.md");
  assert.equal(r[0].toPath, "plan_phase1.md");
  assert.equal(r[0].signal, "sequence");
  assert.equal(r[0].confidence, "high");
  assert.deepEqual(r[0].why.params, { stem: "plan", later: "phase 2", earlier: "phase 1" });
});

test("inferLinkProposals: a gap in the phase numbers lowers the confidence to medium", () => {
  const r = inferLinkProposals([ld("p", "plan_phase1.md"), ld("p", "plan_phase3.md")], [], new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, "medium");
});

test("inferLinkProposals: two documents with the same phase number leave the order unclear and propose nothing", () => {
  const docs = [ld("p", "plan_phase1.md"), ld("p", "plan_Phase1.md"), ld("p", "plan_phase2.md")];
  assert.deepEqual(inferLinkProposals(docs, [], new Set()), []);
});

test("inferLinkProposals: the same subject as a spec and a plan makes the plan wait on the spec, at low confidence", () => {
  const r = inferLinkProposals([ld("p", "login_spec.md"), ld("p", "login_plan.md")], [], new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].fromPath, "login_plan.md");
  assert.equal(r[0].toPath, "login_spec.md");
  assert.equal(r[0].signal, "stem");
  assert.equal(r[0].confidence, "low");
});

const fanOut = (): LinkDoc[] => [ld("p", "a.md", "Blocked by b.md\nBlocked by c.md\nBlocked by d.md\nBlocked by e.md"), ld("p", "b.md"), ld("p", "c.md"), ld("p", "d.md"), ld("p", "e.md")];

test("inferLinkProposals: one waiting document gets at most three proposals by default, ties cut by key", () => {
  const r = inferLinkProposals(fanOut(), [], new Set());
  assert.deepEqual(r.map((p) => p.toPath), ["b.md", "c.md", "d.md"]);
});

test("inferLinkProposals: the per-document cap can be lowered", () => {
  const r = inferLinkProposals(fanOut(), [], new Set(), { perDocument: 1 });
  assert.deepEqual(r.map((p) => p.toPath), ["b.md"]);
});

test("inferLinkProposals: the total cap limits the whole list", () => {
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md"), ld("p", "c.md", "Blocked by d.md"), ld("p", "d.md")];
  const r = inferLinkProposals(docs, [], new Set(), { total: 1 });
  // Same strength, so the pair whose key sorts first is the one kept.
  assert.deepEqual(r.map((p) => p.key), ["p/a.md->p/b.md"]);
});

test("inferLinkProposals: turning off every phrase leaves only the weaker mention", () => {
  const docs = [ld("p", "a.md", "Blocked by b.md"), ld("p", "b.md")];
  for (const phrases of [["needs"], []]) {
    const r = inferLinkProposals(docs, [], new Set(), { phrases });
    assert.equal(r.length, 1);
    assert.equal(r[0].signal, "mention");
    assert.equal(r[0].confidence, "low");
  }
});

test("inferLinkProposals: stronger proposals come first", () => {
  const docs = [ld("p", "a.md", "See z.md"), ld("p", "z.md"), ld("p", "c.md", "Blocked by d.md"), ld("p", "d.md")];
  const r = inferLinkProposals(docs, [], new Set());
  // The phrase (high) sorts ahead of the mention (low) although its key sorts later.
  assert.deepEqual(r.map((p) => p.signal), ["phrase", "mention"]);
});

test("inferLinkProposals: the order the documents arrive in does not change the result", () => {
  const docs = [
    ld("p", "a.md", "Blocked by b.md\nsee c.md"),
    ld("p", "b.md"),
    ld("p", "c.md"),
    ld("p", "plan_phase1.md"),
    ld("p", "plan_phase2.md"),
    ld("p", "login_spec.md"),
    ld("p", "login_plan.md"),
  ];
  assert.deepEqual(inferLinkProposals([...docs].reverse(), [], new Set()), inferLinkProposals(docs, [], new Set()));
});

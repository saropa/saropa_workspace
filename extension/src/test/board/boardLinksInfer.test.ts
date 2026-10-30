// Link inference engine: sequences, phrases, same-stem files, traps, dedupe, loops, caps.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { Link } from "../../board/links";
import { LinkProposal, inferLinkProposals, proposalKey, wouldCircle } from "../../board/org/linksInfer";
import { LinkDoc } from "../../board/org/linksSignals";

const doc = (p: string, text = "", project = "app", title = ""): LinkDoc => ({ project, path: p, title, text });
const pair = (r: LinkProposal): string => `${r.fromPath}->${r.toPath}`;
const run = (docs: LinkDoc[], existing: Link[] = [], rejected: string[] = []): LinkProposal[] => inferLinkProposals(docs, existing, new Set(rejected));

test("numbered phases: each waits on the one before, high when consecutive", () => {
  const r = run([doc("docs/share_keys_phase3.md"), doc("docs/share_keys_phase1.md"), doc("docs/share_keys_phase2.md")]);
  assert.deepEqual(r.map(pair), ["docs/share_keys_phase2.md->docs/share_keys_phase1.md", "docs/share_keys_phase3.md->docs/share_keys_phase2.md"]);
  assert.ok(r.every((p) => p.confidence === "high" && p.signal === "sequence"));
  assert.equal(r[0].why.key, "releaseBoard.linkWhy.sequence");
  assert.equal(r[0].why.params.later, "phase 2");
});

test("versions and letter parts are sequences; a gap is medium; other folders are not mixed", () => {
  const r = run([doc("a/api_v1.md"), doc("a/api_v3.md"), doc("a/rollout-part-a.md"), doc("a/rollout-part-b.md"), doc("b/api_v2.md")]);
  assert.deepEqual(r.map((p) => [pair(p), p.confidence]), [
    ["a/rollout-part-b.md->a/rollout-part-a.md", "high"],
    ["a/api_v3.md->a/api_v1.md", "medium"],
  ]);
});

test("two files with the same number are left out", () => {
  assert.deepEqual(run([doc("a/x_phase1.md"), doc("a/x-phase1.md"), doc("a/x_phase2.md")]).length, 0);
});

test("phrases: blocked by, depends on, X blocks this, this blocks X", () => {
  const r = run([
    doc("docs/a.md", "This is blocked by docs/b.md until later.\nIt depends on [the c](c.md)."),
    doc("docs/b.md"),
    doc("docs/c.md"),
    doc("docs/d.md", "docs/e.md blocks this.\n"),
    doc("docs/e.md", "This plan blocks `docs/f.md`."),
    doc("docs/f.md"),
  ]);
  const got = new Set(r.map(pair));
  assert.ok(got.has("docs/a.md->docs/b.md"));
  assert.ok(got.has("docs/a.md->docs/c.md"));
  assert.ok(got.has("docs/d.md->docs/e.md"));
  assert.ok(got.has("docs/f.md->docs/e.md"));
  assert.equal(r.find((p) => pair(p) === "docs/a.md->docs/b.md")!.confidence, "high");
  assert.equal(r.find((p) => pair(p) === "docs/a.md->docs/b.md")!.why.params.phrase, "blocked by");
});

test("a quoted exact title resolves one step weaker", () => {
  const r = run([doc("a.md", 'Waits on "Store launch".'), doc("b.md", "", "app", "Store launch")]);
  assert.deepEqual(r.map((p) => [pair(p), p.confidence]), [["a.md->b.md", "medium"]]);
});

test("traps: afterwards, plain prose, negation and code blocks make nothing", () => {
  const r = run([
    doc("a.md", "Afterwards we ship b.md notes.\nThe release goes out after the review.\nIt no longer depends on b.md.\nNot blocked by b.md."),
    doc("c.md", "```\nblocked by b.md\ndepends on b.md\n```\n"),
    doc("b.md"),
  ]);
  // "Afterwards ... b.md" is a plain mention, never a phrase.
  assert.deepEqual(r.map((p) => [pair(p), p.signal]), [["a.md->b.md", "mention"]]);
});

test("a Needs: line is not read as a phrase", () => {
  const r = run([doc("a.md", "Needs: b.md"), doc("b.md")]);
  assert.ok(r.every((p) => p.signal !== "phrase"));
});

test("same stem, different kinds: the later kind waits, low", () => {
  const r = run([doc("p/PLAN_share_keys.md"), doc("s/SPEC_share_keys.md"), doc("p/BUG_share_keys.md")]);
  assert.deepEqual(r.map((p) => [pair(p), p.confidence, p.signal]), [["p/PLAN_share_keys.md->s/SPEC_share_keys.md", "low", "stem"]]);
});

test("two plans of one stem are ambiguous: nothing", () => {
  assert.equal(run([doc("a/PLAN_x_core.md"), doc("b/PLAN_x_core.md"), doc("c/SPEC_x_core.md")]).length, 0);
});

test("cross-project: a project:path target works, a unique name elsewhere is weaker", () => {
  const r = run([
    doc("a.md", "Requires lib:docs/core.md.", "app"),
    doc("docs/core.md", "", "lib"),
    doc("b.md", "Depends on shared_notes.md", "app"),
    doc("shared_notes.md", "", "lib"),
  ]);
  assert.deepEqual(r.map((p) => [p.fromPath, p.toProject, p.toPath, p.confidence]), [
    ["a.md", "lib", "docs/core.md", "medium"],
    ["b.md", "lib", "shared_notes.md", "medium"],
  ]);
});

test("an ambiguous name proposes nothing", () => {
  assert.equal(run([doc("a.md", "Blocked by x.md"), doc("d1/x.md"), doc("d2/x.md")]).length, 0);
});

test("existing Needs links and rejected keys are not proposed again", () => {
  const docs = [doc("x_phase1.md"), doc("x_phase2.md"), doc("x_phase3.md")];
  const link: Link = { fromProject: "app", fromPath: "x_phase2.md", target: "x_phase1.md", state: "open", toProject: "app", toPath: "x_phase1.md" };
  const r = run(docs, [link], [proposalKey("app", "x_phase3.md", "app", "x_phase2.md")]);
  assert.equal(r.length, 0);
});

test("a proposal that would close a loop is refused", () => {
  const docs = [doc("a.md", "Blocked by b.md"), doc("b.md"), doc("c.md", "Blocked by a.md")];
  const link: Link = { fromProject: "app", fromPath: "b.md", target: "c.md", state: "open", toProject: "app", toPath: "c.md" };
  // b waits on c: a on b is fine, but then c on a would close the loop a, b, c.
  assert.deepEqual(run(docs, [link]).map(pair), ["a.md->b.md"]);
  assert.equal(wouldCircle(new Map([["x", new Set(["y"])]]), "y", "x"), true);
  assert.equal(wouldCircle(new Map(), "x", "y"), false);
});

test("two documents that name each other keep one direction", () => {
  const r = run([doc("a.md", "Blocked by b.md"), doc("b.md", "Blocked by a.md")]);
  assert.deepEqual(r.map(pair), ["a.md->b.md"]);
});

test("caps: per document and in total", () => {
  const docs = [doc("a.md", "Blocked by b.md, c.md and d.md."), doc("b.md"), doc("c.md"), doc("d.md")];
  assert.equal(run(docs).length, 3);
  assert.equal(inferLinkProposals(docs, [], new Set(), { perDocument: 2 }).length, 2);
  assert.equal(inferLinkProposals(docs, [], new Set(), { total: 1 }).length, 1);
});

test("stronger first, and the order does not depend on the input order", () => {
  const docs = [doc("z_phase2.md"), doc("m.md", "See n.md"), doc("n.md"), doc("z_phase1.md"), doc("q.md", "Depends on n.md")];
  const a = run(docs);
  const b = run([...docs].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((p) => p.confidence), ["high", "high", "low"]);
});

test("every why key has an English message", () => {
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../src/i18n/locales/en.json"), "utf8")) as Record<string, string>;
  const r = run([doc("x_phase1.md"), doc("x_phase2.md"), doc("a.md", "Blocked by b.md."), doc("b.md"), doc("c.md", "See d.md"), doc("d.md"), doc("PLAN_k_core.md"), doc("SPEC_k_core.md")]);
  for (const k of new Set(r.map((p) => p.why.key))) {
    assert.ok(en[k], k);
  }
  for (const c of ["high", "medium", "low"]) {
    assert.ok(en[`releaseBoard.linkConfidence.${c}`]);
  }
  assert.equal(new Set(r.map((p) => p.signal)).size, 4);
});

test("2,000 documents finish quickly and respect the caps", () => {
  const docs: LinkDoc[] = [];
  for (let f = 0; f < 50; f++) {
    for (let i = 1; i <= 40; i++) {
      const text = i % 5 === 0 ? `Blocked by feat${f}_phase${i - 1}.md and afterwards more.\n` : `Notes about the work, see feat${f}_phase${i - 2 > 0 ? i - 2 : 1}.md`;
      docs.push(doc(`docs/f${f}/feat${f}_phase${i}.md`, text.repeat(20)));
    }
  }
  const start = process.hrtime.bigint();
  const r = run(docs);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(docs.length, 2000);
  assert.equal(r.length, 200);
  assert.ok(r.every((p) => p.confidence === "high"));
  assert.ok(ms < 10000, `took ${ms} ms`);
});

test("dotted versions share one stem and compare numerically", () => {
  const r = run([doc("a/api_v1.10.md"), doc("a/api_v1.2.md"), doc("a/api_v1.3.md")]);
  assert.deepEqual(r.map((p) => [pair(p), p.confidence, p.why.params.stem]), [
    ["a/api_v1.3.md->a/api_v1.2.md", "high", "api"],
    ["a/api_v1.10.md->a/api_v1.3.md", "medium", "api"],
  ]);
});

test("a phrase target must start the clause", () => {
  const docs = [doc("a.md", "Requires Node 20. See docs/SETUP.md."), doc("docs/SETUP.md"), doc("b.md", "Blocked by **`docs/SETUP.md`**.\nNeeds [the setup](docs/SETUP.md) and more.")];
  assert.deepEqual(run(docs).filter((p) => p.signal === "phrase").map(pair), ["b.md->docs/SETUP.md"]);
});

test("negation also covers blocks this and this blocks", () => {
  const r = run([doc("a.md", "b.md no longer blocks this."), doc("c.md", "This plan does not\nthis no longer blocks a.md"), doc("b.md"), doc("d.md", "This plan no longer blocks a.md.")]);
  assert.equal(r.filter((p) => p.signal === "phrase").length, 0);
});

test("code is ignored: unclosed fence, tilde fence, indented block, inline span", () => {
  const texts = ["```\nblocked by b.md", "~~~\nblocked by b.md\n~~~~", "intro\n\n    blocked by b.md\n", "Use `blocked by b.md` here."];
  for (const t of texts) {
    assert.equal(run([doc("a.md", t), doc("b.md")]).length, 0, t);
  }
  assert.equal(run([doc("a.md", "```\nx\n```\nBlocked by b.md"), doc("b.md")]).length, 1);
});

test("same pair, tied strength: output does not depend on input order", () => {
  const docs = [doc("a.md", "Blocked by b.md."), doc("b.md", "This blocks a.md."), doc("c.md")];
  const want = JSON.stringify(run(docs));
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    assert.equal(JSON.stringify(run(p.map((k) => docs[k]))), want);
  }
});

test("a long line with many phrases finishes quickly", () => {
  const line = "needs x ".repeat(250).slice(0, 2000) + "\n" + "Blocked by b.md ".repeat(180);
  const start = process.hrtime.bigint();
  run([doc("a.md", line.slice(0, 2000)), doc("b.md")]);
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 2000);
});

test(".md needs an end boundary", () => {
  assert.equal(run([doc("a.md", "Blocked by b.md.bak and see b.md.bak"), doc("b.md")]).length, 0);
});

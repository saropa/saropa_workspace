// Board link proposals: buildProposals (the engine run over open documents, with its cache, the
// existing-link, rejection and dashed-suggestion filters) and proposalRows (proposals turned into
// review-list rows, with the reasons a proposal is skipped). Snapshots are built from readFacts.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardItem } from "../../board/boardModelParts";
import { ProposalView, buildProposals, proposalRows, resetProposalCache } from "../../board/boardProposals";
import { readFacts } from "../../board/docFacts";
import type { Link } from "../../board/links";
import type { PatchTarget } from "../../board/patch";
import type { ScanSnapshot } from "../../board/scanner";
import type { BoardConfig } from "../../board/types";

// No organize key: the default link phrases apply.
const cfg = { version: 1, ignore: [], ruleSets: {}, projects: [] } as unknown as BoardConfig;

// An open item of the project "app" with the required fields filled in.
const item = (path: string, title = path): BoardItem => ({ id: 0, project: "app", path, title, status: "amber", kind: "", hub: false, blocksCount: 0, waitsOn: [], pinned: false, stopping: false, blocks: false });

// A snapshot holding the facts read from each document's text, as a real scan would store them.
const snapshotOf = (texts: Record<string, string>): ScanSnapshot =>
  ({ version: 1, takenAt: 0, projects: { app: { counts: {}, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(Object.entries(texts).map(([p, t]) => [p, { mtimeMs: 100_000, size: t.length, facts: readFacts(t, p) }])) } } }) as unknown as ScanSnapshot;

const TEXTS: Record<string, string> = {
  "docs/plan_phase1.md": "# Plan phase 1\n",
  "docs/plan_phase2.md": "# Plan phase 2\n",
  "docs/launch.md": "# Launch\n\nThis is blocked by docs/plan_phase2.md.\n",
  "docs/schema_phase1.sql": "-- Schema phase 1\n",
  "docs/schema_phase2.sql": "-- Schema phase 2\n",
};
const items = (texts: Record<string, string>): BoardItem[] => Object.keys(texts).map((p) => item(p));
const none: ReadonlySet<string> = new Set();
const LAUNCH_KEY = "app/docs/launch.md->app/docs/plan_phase2.md";
const SEQUENCE_KEY = "app/docs/plan_phase2.md->app/docs/plan_phase1.md";

// The engine cache is module-level, so every test starts cold to stay independent of the others.
const run = (over: { links?: Link[]; rejected?: string[]; offered?: ReadonlySet<string>; texts?: Record<string, string> } = {}): ProposalView[] => {
  const texts = over.texts ?? TEXTS;
  return buildProposals(items(texts), snapshotOf(texts), cfg, over.links ?? [], over.rejected, over.offered ?? none);
};

test("buildProposals proposes a link from wording, with project-qualified item and target, a confidence and a reason", () => {
  resetProposalCache();
  const p = run().find((x) => x.key === LAUNCH_KEY);
  assert.ok(p, "the phrase proposal is present");
  assert.equal(p.item, "app:docs/launch.md");
  assert.equal(p.on, "app:docs/plan_phase2.md");
  // A named "blocked by" phrase is the strongest signal.
  assert.equal(p.confidence, "high");
  assert.match(p.why, /blocked by/);
});

test("buildProposals proposes a numbered sequence, later phase waiting on the earlier one", () => {
  resetProposalCache();
  const p = run().find((x) => x.key === SEQUENCE_KEY);
  assert.ok(p);
  assert.equal(p.item, "app:docs/plan_phase2.md");
  assert.equal(p.on, "app:docs/plan_phase1.md");
});

test("buildProposals gives .sql documents no part, as neither side of a proposal", () => {
  resetProposalCache();
  // Schema phase 1 and 2 would be a sequence pair if .sql files read Needs lines; they must not appear at all.
  assert.ok(run().every((p) => !p.item.endsWith(".sql") && !p.on.endsWith(".sql")));
});

test("buildProposals returns nothing for no open documents", () => {
  resetProposalCache();
  assert.deepEqual(buildProposals([], undefined, cfg, [], undefined, none), []);
});

test("buildProposals still works when the scan has no snapshot, and finds nothing to read", () => {
  resetProposalCache();
  // Without facts there is no text to find a phrase in; only the file names are left, and these two do not match.
  const res = buildProposals([item("docs/alpha.md"), item("docs/omega.md")], undefined, cfg, [], undefined, none);
  assert.deepEqual(res, []);
});

test("buildProposals leaves out a pair that is already linked", () => {
  resetProposalCache();
  const linked: Link = { fromProject: "app", fromPath: "docs/launch.md", target: "docs/plan_phase2.md", state: "open", toProject: "app", toPath: "docs/plan_phase2.md" };
  const keys = run({ links: [linked] }).map((p) => p.key);
  assert.ok(!keys.includes(LAUNCH_KEY));
  // The unrelated sequence proposal is unaffected.
  assert.ok(keys.includes(SEQUENCE_KEY));
});

test("buildProposals ignores a link that did not resolve to a document", () => {
  resetProposalCache();
  // A missing target has no toProject/toPath, so it cannot stand for any proposal pair.
  const unresolved: Link = { fromProject: "app", fromPath: "docs/launch.md", target: "docs/gone.md", state: "missing" };
  assert.ok(run({ links: [unresolved] }).some((p) => p.key === LAUNCH_KEY));
});

test("buildProposals leaves out a rejected pair", () => {
  resetProposalCache();
  const keys = run({ rejected: [LAUNCH_KEY] }).map((p) => p.key);
  assert.ok(!keys.includes(LAUNCH_KEY));
  assert.ok(keys.includes(SEQUENCE_KEY));
});

test("buildProposals does not propose a link that would close a loop with an existing one", () => {
  resetProposalCache();
  // Phase 1 already waits on phase 2, so "phase 2 waits on phase 1" would be a circle.
  const existing: Link = { fromProject: "app", fromPath: "docs/plan_phase1.md", target: "docs/plan_phase2.md", state: "open", toProject: "app", toPath: "docs/plan_phase2.md" };
  assert.ok(!run({ links: [existing] }).some((p) => p.key === SEQUENCE_KEY));
});

test("buildProposals keeps a strong pair the dashed suggestions already offer, but leaves a mention to them", () => {
  resetProposalCache();
  // A phrase pair is shown here whatever the dashed list holds.
  assert.ok(run({ offered: new Set([LAUNCH_KEY]) }).some((p) => p.key === LAUNCH_KEY));
  resetProposalCache();
  const texts = { "docs/notes.md": "# Notes\n\nBackground notes live in docs/target.md today.\n", "docs/target.md": "# Target\n" };
  const mentionKey = "app/docs/notes.md->app/docs/target.md";
  assert.ok(run({ texts }).some((p) => p.key === mentionKey), "a plain mention is proposed when nothing offers it");
  resetProposalCache();
  // A bare mention that the dashed suggestions already show is left to them.
  assert.ok(!run({ texts, offered: new Set([mentionKey]) }).some((p) => p.key === mentionKey));
});

test("buildProposals answers from its cache while documents, links, rejections and offers are unchanged", () => {
  resetProposalCache();
  const first = run();
  // The same inputs give the very same array: the engine did not run again.
  assert.equal(run(), first);
});

test("buildProposals runs the engine again when a rejection changes, and after the cache is reset", () => {
  resetProposalCache();
  const first = run();
  const second = run({ rejected: [LAUNCH_KEY] });
  assert.notEqual(second, first);
  assert.ok(first.some((p) => p.key === LAUNCH_KEY) && !second.some((p) => p.key === LAUNCH_KEY));
  resetProposalCache();
  const again = run({ rejected: [LAUNCH_KEY] });
  // Same content, freshly computed.
  assert.notEqual(again, second);
  assert.deepEqual(again, second);
});

test("buildProposals runs the engine again when a document's text changes", () => {
  resetProposalCache();
  const before = run();
  const after = run({ texts: { ...TEXTS, "docs/launch.md": "# Launch\n" } });
  assert.ok(before.some((p) => p.key === LAUNCH_KEY));
  // Without the phrase the wording proposal is gone: the cache key covers the text.
  assert.ok(!after.some((p) => p.key === LAUNCH_KEY));
});

// A board target for the review list: title, path, revision and the items it already waits on.
const target = (project: string, path: string, over: Partial<PatchTarget> = {}): PatchTarget => ({ id: `${project}:${path}`, title: path.replace(/^docs\//, "").replace(/\.\w+$/, "").toUpperCase(), project, path, rev: "1-2", status: "amber", needs: [], ...over });
const targetMap = (...ts: PatchTarget[]): Map<string, PatchTarget> => new Map(ts.map((t) => [t.id, t]));
const proposal = (item: string, on: string, over: Partial<ProposalView> = {}): ProposalView => ({ key: `${item}->${on}`, item, on, confidence: "high", why: "because", ...over });
const A = "app:docs/a.md";
const B = "app:docs/b.md";

test("proposalRows turns a proposal into an add-a-Needs-link row carrying its reason and revision", () => {
  const { rows, skipped } = proposalRows([proposal(A, B)], targetMap(target("app", "docs/a.md"), target("app", "docs/b.md")));
  assert.deepEqual(skipped, []);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.change.op, "addNeeds");
  assert.equal(r.change.item, A);
  assert.equal(r.change.on, B);
  assert.equal(r.change.reason, "because");
  assert.equal(r.change.rev, "1-2");
  // The row shows nothing before and the waited-on document's title after.
  assert.equal(r.before, "");
  assert.equal(r.after, "B");
  assert.equal(r.stale, false);
});

test("proposalRows is empty for no proposals", () => {
  assert.deepEqual(proposalRows([], targetMap()), { rows: [], skipped: [] });
});

test("proposalRows leaves out, without listing as skipped, a proposal whose document the board does not show", () => {
  const targets = targetMap(target("app", "docs/a.md"));
  const out = proposalRows([proposal(A, B), proposal("app:docs/gone.md", A)], targets);
  assert.deepEqual(out, { rows: [], skipped: [] });
});

test("proposalRows skips a proposal for an unread document and says why, naming both documents", () => {
  const noRev = target("app", "docs/a.md");
  delete noRev.rev;
  const { rows, skipped } = proposalRows([proposal(A, B)], targetMap(noRev, target("app", "docs/b.md")));
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].key, `${A}->${B}`);
  // Without a file revision the change could not be checked for staleness, so it is refused as unread.
  assert.equal(skipped[0].text, "A waiting on B: the document has not been read by the scan yet");
});

test("proposalRows skips a link that already exists", () => {
  const a = target("app", "docs/a.md", { needs: [B] });
  const { rows, skipped } = proposalRows([proposal(A, B)], targetMap(a, target("app", "docs/b.md")));
  assert.equal(rows.length, 0);
  assert.equal(skipped[0].text, "A waiting on B: the link already exists");
});

test("proposalRows skips a link that would make a circle with a link the board already has", () => {
  const b = target("app", "docs/b.md", { needs: [A] });
  const { rows, skipped } = proposalRows([proposal(A, B)], targetMap(target("app", "docs/a.md"), b));
  assert.equal(rows.length, 0);
  assert.equal(skipped[0].text, "A waiting on B: the link would make a circle");
});

test("proposalRows skips a link that would make a circle with an earlier proposal of the same list, and keys the skip to the right proposal", () => {
  const targets = targetMap(target("app", "docs/a.md"), target("app", "docs/b.md"));
  // The first proposal is for a document the board does not show, so it is dropped before checking; the
  // skip position must still map to the proposal that failed, not to the dropped one.
  const dropped = proposal("app:docs/gone.md", A);
  const first = proposal(A, B);
  const second = proposal(B, A);
  const { rows, skipped } = proposalRows([dropped, first, second], targets);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].change.item, A);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].key, second.key);
  assert.equal(skipped[0].text, "B waiting on A: the link would make a circle");
});

test("proposalRows skips a document that reads no Needs lines (.sql) and names that reason", () => {
  const sql = target("app", "docs/schema.sql");
  const { rows, skipped } = proposalRows([proposal("app:docs/schema.sql", B)], targetMap(sql, target("app", "docs/b.md")));
  assert.equal(rows.length, 0);
  assert.equal(skipped[0].text, "SCHEMA waiting on B: a .sql file does not read Needs lines");
});

test("proposalRows skips a target whose file name cannot be written into a Needs line", () => {
  const spaced = target("app", "docs/my file.md");
  const { rows, skipped } = proposalRows([proposal(A, "app:docs/my file.md")], targetMap(target("app", "docs/a.md"), spaced));
  assert.equal(rows.length, 0);
  assert.equal(skipped[0].text, "A waiting on MY FILE: a file name has characters that cannot go in a Needs line");
});

test("proposalRows lists a repeated proposal for the same pair once and skips the second", () => {
  const targets = targetMap(target("app", "docs/a.md"), target("app", "docs/b.md"));
  const first = proposal(A, B);
  const repeat = proposal(A, B, { key: "other-key" });
  const { rows, skipped } = proposalRows([first, repeat], targets);
  assert.equal(rows.length, 1);
  assert.deepEqual(skipped.map((s) => s.key), ["other-key"]);
});

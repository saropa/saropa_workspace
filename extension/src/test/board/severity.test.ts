// Severity phrases and release profiles. The levels match the prototype on the 68 open
// documents of the three Saropa repositories (checked by hand when the scorer was ported).

import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDocument, stops } from "../../board/severity";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig, Classified, emptyCounts } from "../../board/types";
import { readFacts } from "../../board/docFacts";
import { ScanSnapshot } from "../../board/scanner";

test("title and head phrases decide the level; code fences and negation are ignored", () => {
  assert.equal(scoreDocument("# Refund and billing bug\n", "docs/PLAN_x.md").severity, "extreme");
  assert.equal(scoreDocument("# Notes\n\n```\npayment payment payment\n```\n", "docs/notes.md").severity, "medium");
  assert.equal(scoreDocument("# Notes about data loss\nWe fear data loss.\n", "docs/notes.md").severity, "critical");
  assert.equal(scoreDocument("# Notes\nThere is no payment change.\n", "docs/notes.md").severity, "medium");
  assert.equal(scoreDocument("# Notes\nA tip jar page.\n", "docs/notes.md").audience, "pro");
});

test("profiles decide which levels stop a release", () => {
  assert.ok(stops("rush", "critical") && !stops("rush", "high"));
  assert.ok(stops("deliberate", "high") && !stops("deliberate", "medium"));
  assert.ok(stops("zero", "medium") && !stops("zero", "low"));
});

const cfg = (profile: BoardConfig["profile"], pinned?: string[]): BoardConfig => ({
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }],
  profile,
  pinned,
});
const row = (path: string): Classified => ({ project: "app", path, status: "amber", kind: "", note: "" });
const snap = (docs: Record<string, string>): ScanSnapshot => ({
  version: 1,
  takenAt: 1,
  projects: {
    app: {
      counts: emptyCounts(),
      folders: {},
      ruleCounts: {},
      greyFolders: { "docs/x": 2 },
      files: {},
      facts: Object.fromEntries(Object.entries(docs).map(([p, t]) => [p, { size: 1, mtimeMs: 1, facts: readFacts(t, p) }])),
    },
  },
});

test("an open item of a stopping severity makes the project NO-GO under that profile only", () => {
  const rows = [row("docs/A.md")];
  const s = snap({ "docs/A.md": "# Search colour tweak\nbutton colour\n" });
  const high = snap({ "docs/A.md": "# User uptake\nuptake onboarding retention\n" });
  const level = scoreDocument("# User uptake\nuptake onboarding retention\n", "docs/A.md").severity;
  assert.equal(level, "high");
  assert.equal(buildBoard(cfg("rush"), rows, undefined, true, high).projects[0].light, "unverified");
  assert.equal(buildBoard(cfg("deliberate"), rows, undefined, true, high).projects[0].light, "no-go");
  assert.equal(buildBoard(cfg("deliberate"), rows, undefined, true, s).projects[0].light, "unverified");
});

test("a pinned document stops a release in every profile and sorts first; grey folders are listed", () => {
  const rows = [row("docs/A.md"), row("docs/B.md")];
  const s = snap({ "docs/A.md": "# Colour\n", "docs/B.md": "# Colour\n" });
  const m = buildBoard(cfg("rush", ["app/docs/B.md"]), rows, undefined, true, s);
  assert.equal(m.projects[0].light, "no-go");
  assert.equal(m.items[0].path, "docs/B.md");
  assert.deepEqual(m.needsRule, [{ project: "app", folder: "docs/x", count: 2 }]);
});

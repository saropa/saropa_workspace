// Sittings: the phrase dictionary, which steps fit what is in hand, the order, and the
// untagged line. Also the steps docFacts keeps (line numbers, headings, the Needs column).

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEEDS, matchNeeds, mergeNeeds, stepMinutes, stepNeeds, timeHint } from "../../board/needs";
import { SittingDoc, buildSittings, asTimeBox } from "../../board/sittings";
import { readFacts } from "../../board/docFacts";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig, Classified } from "../../board/types";
import { ScanSnapshot } from "../../board/scanner";

const step = (text: string, extra: { heading?: string; needsCell?: string; line?: number } = {}) => ({ line: extra.line ?? 1, heading: extra.heading ?? "", text, needsCell: extra.needsCell });
const doc = (over: Partial<SittingDoc> & { steps: SittingDoc["steps"] }): SittingDoc => ({ project: "app", projectName: "App", path: "bugs/human/A.md", title: "A", blocksCount: 0, ...over });
const sel = (have: string[], timeBox: "any" | "15" | "30" | "60" = "any", maxSteps = 25) => ({ have, timeBox, maxSteps });

test("phrases match whole words only", () => {
  assert.deepEqual(matchNeeds("Install the machine build"), []);
  assert.deepEqual(matchNeeds("Open the Mac."), [["mac"]]);
  assert.deepEqual(matchNeeds("Run in Supabase SQL Editor"), [["supabase"]]);
});

test("a phrase can name several contexts, and several phrases all have to be met", () => {
  assert.deepEqual(matchNeeds("Upload to TestFlight"), [["iphone", "mac"]]);
  // "iPhone" alone already satisfies "iPhone or Mac", so the wider group is dropped.
  assert.deepEqual(matchNeeds("TestFlight on the iPhone"), [["iphone"]]);
  assert.deepEqual(matchNeeds("Check the iPhone, then the Mac"), [["iphone"], ["mac"]]);
});

test("a Needs column is read first, then the text, then the heading", () => {
  assert.deepEqual(stepNeeds(step("Test 15 on the Windows box", { needsCell: "iPhone, Mac" })), [["iphone"], ["mac"]]);
  assert.deepEqual(stepNeeds(step("Open adb logcat", { needsCell: "nothing" })), [["android"]]);
  assert.deepEqual(stepNeeds(step("Check it", { heading: "On the iPhone" })), [["iphone"]]);
  assert.deepEqual(stepNeeds(step("Check it")), []);
});

test("a team dictionary adds contexts and phrases and can switch a shipped phrase off", () => {
  const d = mergeNeeds({ contexts: [{ id: "nas", label: "Home NAS" }], phrases: { "nas share": ["nas"], testflight: [] } });
  assert.deepEqual(matchNeeds("Mount the NAS share", d), [["nas"]]);
  assert.deepEqual(matchNeeds("Upload to TestFlight", d), []);
  assert.equal(d.contexts.length, DEFAULT_NEEDS.contexts.length + 1);
  assert.equal(mergeNeeds(undefined), DEFAULT_NEEDS);
  // A phrase naming an unknown context matches nothing.
  assert.deepEqual(matchNeeds("zzz", mergeNeeds({ phrases: { zzz: ["nope"] } })), []);
});

test("time hints and per-context defaults", () => {
  assert.equal(timeHint("a 4-minute wait"), 4);
  assert.equal(timeHint("about 1.5 hours"), 90);
  assert.equal(timeHint("no hint"), undefined);
  assert.equal(stepMinutes("Run it", [["supabase"]]), 5);
  assert.equal(stepMinutes("Run it", [["iphone", "mac"]]), 10);
  assert.equal(stepMinutes("Run it", [["mac"], ["iphone"]]), 15);
  assert.equal(stepMinutes("Run it", []), DEFAULT_NEEDS.defaultMinutes);
  assert.equal(stepMinutes("30 min soak on the Mac", [["mac"]]), 30);
});

test("only steps that need nothing beyond what is in hand are listed", () => {
  const d = doc({ steps: [step("Test on iPhone", { line: 3 }), step("Run in Supabase SQL Editor", { line: 4 }), step("Build on Windows", { line: 5 }), step("Check iPhone and Mac", { line: 6 })] });
  const r = buildSittings([d], DEFAULT_NEEDS, sel(["iphone"]));
  assert.deepEqual(r.lines.map((l) => l.line), [3]);
  const both = buildSittings([d], DEFAULT_NEEDS, sel(["iphone", "mac"]));
  assert.deepEqual(both.lines.map((l) => l.line).sort(), [3, 6]);
  assert.deepEqual(buildSittings([d], DEFAULT_NEEDS, sel([])).lines, []);
});

test("the time box hides longer steps and counts them", () => {
  const d = doc({ steps: [step("Soak test on the Mac, 45 min", { line: 1 }), step("Quick look on the Mac, 5 min", { line: 2 })] });
  const r = buildSittings([d], DEFAULT_NEEDS, sel(["mac"], "15"));
  assert.deepEqual(r.lines.map((l) => l.line), [2]);
  assert.equal(r.tooLong, 1);
  assert.equal(buildSittings([d], DEFAULT_NEEDS, sel(["mac"], "60")).lines.length, 2);
});

test("order: what unblocks most, then severity, then the shortest, then position", () => {
  const docs = [
    doc({ path: "bugs/human/LOW.md", severity: "low", blocksCount: 0, steps: [step("Mac check, 5 min")] }),
    doc({ path: "bugs/human/BLOCKER.md", severity: "low", blocksCount: 2, steps: [step("Mac check, 40 min")] }),
    doc({ path: "bugs/human/CRIT_LONG.md", severity: "critical", blocksCount: 0, steps: [step("Mac check, 20 min")] }),
    doc({ path: "bugs/human/CRIT_SHORT.md", severity: "critical", blocksCount: 0, steps: [step("Mac check, 10 min")] }),
  ];
  const r = buildSittings(docs, DEFAULT_NEEDS, sel(["mac"]));
  assert.deepEqual(r.lines.map((l) => l.path.split("/").pop()), ["BLOCKER.md", "CRIT_SHORT.md", "CRIT_LONG.md", "LOW.md"]);
});

test("the cap keeps the first steps and counts the rest", () => {
  const steps = Array.from({ length: 8 }, (_, i) => step("Mac check", { line: i + 1 }));
  const r = buildSittings([doc({ steps })], DEFAULT_NEEDS, sel(["mac"], "any", 5));
  assert.equal(r.lines.length, 5);
  assert.equal(r.more, 3);
});

test("steps with no context are never hidden: they go to the untagged line", () => {
  const d = doc({ steps: [step("Tidy the notes", { line: 1 }), step("Mac check", { line: 2 })] });
  for (const have of [[], ["windows"], ["mac"]]) {
    const r = buildSittings([d], DEFAULT_NEEDS, sel(have, "15"));
    assert.deepEqual(r.untagged.map((l) => l.line), [1], `have ${have.join(",")}`);
  }
  const many = doc({ steps: Array.from({ length: 7 }, (_, i) => step("Tidy " + i, { line: i + 1 })) });
  const r = buildSittings([many], DEFAULT_NEEDS, sel([], "any", 5));
  assert.equal(r.untagged.length, 5);
  assert.equal(r.untaggedMore, 2);
});

test("time box values are checked", () => {
  assert.equal(asTimeBox("30"), "30");
  assert.equal(asTimeBox("45"), "any");
  assert.equal(asTimeBox(undefined), "any");
});

const FILE = [
  "# Device checks", // 1
  "", // 2
  "## Sitting 1: iPhone", // 3
  "- [ ] Test 15 backup restore", // 4
  "- [x] Done one", // 5
  "```", // 6
  "- [ ] not a step, in code", // 7
  "```", // 8
  "", // 9
  "| Test | Needs | Status |", // 10
  "|---|---|---|", // 11
  "| Test 16 | iPhone, Mac | Pending |", // 12
  "| Test 17 | Windows PC | Done |", // 13
].join("\n");

test("docFacts keeps each open step with its line, heading and Needs cell", () => {
  const f = readFacts(FILE, "bugs/human/CHECKS.md");
  assert.deepEqual(f.steps, [
    { line: 4, heading: "Sitting 1: iPhone", text: "Test 15 backup restore" },
    { line: 12, heading: "Sitting 1: iPhone", text: "Test 16", needsCell: "iPhone, Mac" },
  ]);
  assert.equal(f.stepsOpen, 1);
  assert.deepEqual([f.rowsAll, f.rowsDone], [2, 1]);
});

test("owner documents only, unless switched off; blocked documents are skipped", () => {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const row = (path: string, kind: string, note = ""): Classified => ({ project: "app", path, status: "red", kind, note });
  const rows = [row("bugs/human/CHECKS.md", "owner action"), row("bugs/BUG_X.md", "bug"), row("bugs/blocked/WAIT.md", "owner action", "blocked")];
  const facts = (p: string) => ({ size: 1, mtimeMs: 1, facts: readFacts("# T\n- [ ] Mac check\n", p) });
  const snap: ScanSnapshot = {
    version: 1,
    takenAt: 1,
    projects: { app: { counts: {} as never, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(rows.map((r) => [r.path, facts(r.path)])) } },
  };
  const run = (onlyOwner: boolean, c: BoardConfig = cfg) =>
    buildBoard(c, rows, undefined, true, snap, undefined, undefined, { sittings: { selection: sel(["mac"]), onlyOwner } }).sittings!;
  assert.deepEqual(run(true).lines.map((l) => l.path), ["bugs/human/CHECKS.md"]);
  assert.deepEqual(run(false).lines.map((l) => l.path), ["bugs/BUG_X.md", "bugs/human/CHECKS.md"]);
  // The rules file can name other owner kinds and folders.
  assert.deepEqual(run(true, { ...cfg, ownerKinds: ["bug"] }).lines.map((l) => l.path), ["bugs/BUG_X.md"]);
  assert.deepEqual(run(true, { ...cfg, ownerKinds: [], ownerFolders: ["Human"] }).lines.map((l) => l.path), ["bugs/human/CHECKS.md"]);
  // Switched off: no view at all.
  assert.equal(buildBoard(cfg, rows, undefined, true, snap).sittings, undefined);
});

test("a blank phrase in a team dictionary cannot hang the matcher", () => {
  const d = mergeNeeds({ phrases: { "": ["iphone"], "   ": ["mac"] } as Record<string, string[]> });
  assert.equal(d.phrases[""], undefined);
  assert.deepEqual(matchNeeds("Open the iPhone", d), [["iphone"]]);
  // Even a dictionary built by hand with a blank key terminates.
  assert.deepEqual(matchNeeds("anything", { ...DEFAULT_NEEDS, phrases: { "": ["iphone"] } }), []);
});

test("minutes from an override are checked", () => {
  const d = mergeNeeds({ contexts: [{ id: "mac", label: "Mac", minutes: "soon" as unknown as number }, { id: "x", label: "X", minutes: -3 }] });
  assert.equal(d.contexts.find((c) => c.id === "mac")?.minutes, 15);
  assert.equal(d.contexts.find((c) => c.id === "x")?.minutes, undefined);
});

test("'iPhone or Android' is one either-or group", () => {
  assert.deepEqual(matchNeeds("Check on iPhone or Android"), [["android", "iphone"]]);
  assert.deepEqual(matchNeeds("Check on iPhone/Android"), [["android", "iphone"]]);
  assert.deepEqual(matchNeeds("Check on iPhone and Android"), [["iphone"], ["android"]]);
  const r = buildSittings([doc({ steps: [step("Check on iPhone or Android")] })], DEFAULT_NEEDS, sel(["android"]));
  assert.equal(r.lines.length, 1);
});

test("tagged steps that need something not in hand are counted", () => {
  const d = doc({ steps: [step("Build on Windows PC"), step("Mac check"), step("Run in Supabase SQL Editor", { heading: "x" })] });
  const r = buildSittings([d], DEFAULT_NEEDS, sel(["mac"]));
  assert.equal(r.needOther, 2);
  assert.equal(r.lines.length, 1);
});

test("hyphenated and plain words do not tag", () => {
  assert.deepEqual(matchNeeds("A pixel-perfect layout"), []);
  assert.deepEqual(matchNeeds("Close the windows and the tab"), []);
  assert.deepEqual(matchNeeds("On the Pixel phone"), [["android"]]);
});

test("steps past the per-document limit are counted and added to the more line", () => {
  const body = Array.from({ length: 205 }, () => "- [ ] Mac check").join("\n");
  const f = readFacts(body, "bugs/human/BIG.md");
  assert.equal(f.steps.length, 200);
  assert.equal(f.stepsCut, 5);
  assert.equal(readFacts("| T | Needs | Status |\n|---|---|---|\n| a | " + "x".repeat(500) + " | Pending |", "a.md").steps[0].needsCell?.length, 160);
  const r = buildSittings([doc({ steps: [step("Mac check")], cut: 5 })], DEFAULT_NEEDS, sel(["mac"]));
  assert.equal(r.more, 5);
});

test("ownerKinds and ownerFolders of the wrong type fall back to the defaults", () => {
  const cfg = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }], ownerKinds: "bug", ownerFolders: [5, "human"] } as unknown as BoardConfig;
  const rows: Classified[] = [{ project: "app", path: "bugs/human/C.md", status: "red", kind: "owner action", note: "" }, { project: "app", path: "bugs/B.md", status: "red", kind: "bug", note: "" }];
  const snap = { version: 1, takenAt: 1, projects: { app: { counts: {} as never, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(rows.map((r) => [r.path, { size: 1, mtimeMs: 1, facts: readFacts("# T\n- [ ] Mac check\n", r.path) }])) } } } as ScanSnapshot;
  const v = buildBoard(cfg, rows, undefined, true, snap, undefined, undefined, { sittings: { selection: sel(["mac"]), onlyOwner: true } }).sittings!;
  assert.deepEqual(v.lines.map((l) => l.path), ["bugs/human/C.md"]);
});

test("a document waiting on an open Needs link lists no steps", () => {
  const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: [], ruleSets: [] }] };
  const rows: Classified[] = ["bugs/human/WAITS.md", "bugs/human/FIRST.md"].map((path) => ({ project: "app", path, status: "red", kind: "owner action", note: "" }));
  const text = (p: string) => (p.includes("WAITS") ? "# Waits\nNeeds: FIRST.md\n- [ ] Mac check\n" : "# First\n- [ ] Mac check\n");
  const snap = { version: 1, takenAt: 1, projects: { app: { counts: {} as never, folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: Object.fromEntries(rows.map((r) => [r.path, { size: 1, mtimeMs: 1, facts: readFacts(text(r.path), r.path) }])) } } } as ScanSnapshot;
  const v = buildBoard(cfg, rows, undefined, true, snap, undefined, undefined, { sittings: { selection: sel(["mac"]), onlyOwner: true } }).sittings!;
  assert.deepEqual(v.lines.map((l) => l.path), ["bugs/human/FIRST.md"]);
});

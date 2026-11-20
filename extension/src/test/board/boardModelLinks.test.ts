// The link steps of the board build (board/boardModelLinks.ts), run on hand-built rows, snapshots and items.
// Pure: no vscode import. Written, not run by the build agent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { attachChats, attachLinks, buildChainSteps, collectNeeds, linkFlags, needsRuleFolders } from "../../board/boardModelLinks";
import type { BoardItem } from "../../board/boardModelParts";
import type { Link } from "../../board/links";
import type { ScanSnapshot } from "../../board/scanner";
import type { BoardConfig, Classified } from "../../board/types";

// Minimal row: only the fields the functions under test read.
const row = (project: string, path: string, status: Classified["status"]): Classified => ({ project, path, status, kind: "doc", note: "" });

// A snapshot whose open documents carry the given Needs targets. The cast stands for the many fields no test here reads.
function snap(needs: Record<string, string[]>, grey: Record<string, number> = {}): ScanSnapshot {
  const facts: Record<string, unknown> = {};
  for (const [path, n] of Object.entries(needs)) {
    facts[path] = { size: 1, mtimeMs: 1000, facts: { needs: n } };
  }
  return { version: 1, takenAt: 0, projects: { app: { facts, greyFolders: grey } } } as unknown as ScanSnapshot;
}

// A board item with every required field; tests override what they care about.
const item = (id: number, project: string, path: string): BoardItem =>
  ({ id, project, path, title: path, status: "red", kind: "doc", hub: false, blocksCount: 0, waitsOn: [], pinned: false, stopping: false, blocks: false }) as BoardItem;

const link = (from: string, to: string | undefined, state: Link["state"]): Link => ({
  fromProject: "app",
  fromPath: from,
  target: to ?? "ghost.md",
  state,
  ...(to ? { toProject: "app", toPath: to } : {}),
});

test("collectNeeds reads the Needs of open documents and skips finished ones", () => {
  const s = snap({ "a.md": ["b.md"], "c.md": ["d.md"] });
  const needs = collectNeeds([row("app", "a.md", "red"), row("app", "c.md", "green")], s, undefined);
  assert.deepEqual([...needs.entries()], [["app\ta.md", ["b.md"]]]);
});

test("collectNeeds merges accepted links without repeating a target the text already names", () => {
  const s = snap({ "a.md": ["b.md"] });
  const needs = collectNeeds([row("app", "a.md", "amber")], s, { "app/a.md": ["b.md", "x.md"], "app/new.md": ["y.md"] });
  assert.deepEqual(needs.get("app\ta.md"), ["b.md", "x.md"]);
  assert.deepEqual(needs.get("app\tnew.md"), ["y.md"]);
});

test("collectNeeds returns an empty map for no rows and no snapshot", () => {
  assert.equal(collectNeeds([], undefined, undefined).size, 0);
});

test("attachLinks counts blockers and fills waitsOn only for open links with a known target", () => {
  const a = item(1, "app", "a.md");
  const b = item(2, "app", "b.md");
  const byKey = new Map([
    ["app\ta.md", a],
    ["app\tb.md", b],
  ]);
  const grouping = { groupOf: new Map(), hubs: new Set(["app\tb.md"]) } as never;
  // The duplicate link must not list b twice; the "done" link must change nothing.
  attachLinks([a, b], [link("a.md", "b.md", "open"), link("a.md", "b.md", "open"), link("b.md", "a.md", "done")], grouping, byKey);
  assert.deepEqual(a.waitsOn, [2]);
  assert.equal(b.blocksCount, 2);
  assert.equal(a.blocksCount, 0);
  assert.equal(b.hub, true);
  assert.equal(a.hub, false);
  assert.equal(a.link?.state, "open");
});

test("buildChainSteps lists the prerequisite first and names the project", () => {
  const a = item(1, "app", "docs/A_plan.md");
  const b = item(2, "app", "docs/B_plan.md");
  const byKey = new Map([
    ["app\tdocs/A_plan.md", a],
    ["app\tdocs/B_plan.md", b],
  ]);
  const chains = buildChainSteps([link("docs/A_plan.md", "docs/B_plan.md", "open")], byKey, new Map([["app", "The App"]]));
  assert.equal(chains.length, 1);
  assert.deepEqual(
    chains[0].map((s) => s.path),
    ["docs/B_plan.md", "docs/A_plan.md"]
  );
  assert.equal(chains[0][0].project, "The App");
  assert.equal(chains[0][0].done, false);
});

test("buildChainSteps falls back to a title from the path when the document is not on the board", () => {
  const chains = buildChainSteps([link("a.md", "docs/Gone.md", "open")], new Map(), new Map());
  const gone = chains[0].find((s) => s.path === "docs/Gone.md");
  assert.equal(gone?.title, "Gone");
  assert.equal(gone?.id, undefined);
  assert.equal(gone?.project, "app");
});

test("buildChainSteps ignores links that are not open", () => {
  assert.deepEqual(buildChainSteps([link("a.md", "b.md", "done"), link("a.md", undefined, "missing")], new Map(), new Map()), []);
});

test("linkFlags writes one line for each link that is not open and none for open ones", () => {
  const flags = linkFlags([link("docs/A_plan.md", "b.md", "open"), link("docs/A_plan.md", undefined, "missing"), link("c.md", "c.md", "self")], new Map([["app", "The App"]]));
  assert.deepEqual(flags, ["The App: A_plan — ghost.md: missing", "The App: c — c.md: self"]);
  assert.deepEqual(linkFlags([], new Map()), []);
});

test("needsRuleFolders lists grey folders per project, biggest first, and survives a missing snapshot", () => {
  const cfg = { projects: [{ id: "app" }, { id: "other" }] } as unknown as BoardConfig;
  const got = needsRuleFolders(cfg, snap({}, { notes: 2, scratch: 5 }));
  assert.deepEqual(got, [
    { project: "app", folder: "scratch", count: 5 },
    { project: "app", folder: "notes", count: 2 },
  ]);
  assert.deepEqual(needsRuleFolders(cfg, undefined), []);
});

test("attachChats sets the session count only for documents the outside sources name", () => {
  const a = item(1, "app", "a.md");
  const b = item(2, "app", "b.md");
  attachChats([a, b], { chats: { "app/a.md": 3, "app/z.md": 9 }, groups: [] });
  assert.equal(a.chats, 3);
  assert.equal(b.chats, undefined);
  attachChats([b], undefined);
  assert.equal(b.chats, undefined);
});

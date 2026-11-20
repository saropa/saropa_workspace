// Edge cases of the small pure renderers behind the hand-off, project and chat controls that the page-level tests
// (boardHandoffPage, boardChatsProjectsPage, umbrellaView) do not reach: a label table that is missing or malformed,
// counts that are fractional or empty, and text that carries replacement patterns or markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBox, hl, proposalCounts, proposalsPill, readyPill } from "../../board/boardHtmlHandoff";
import { label, rollupCounts, skippedBlock } from "../../board/boardHtmlProjects";
import { activePill, noticeBar, pollPill } from "../../board/boardHtmlChats";
import type { BoardStrings } from "../../board/boardHtmlUtil";
import type { BoardModel, BoardProject } from "../../board/boardModel";
import { EVIL } from "./boardWebviewFixture";

// A string table with only the parts a test needs; the renderers read nothing else on these paths.
const table = (parts: Record<string, unknown>): BoardStrings => parts as unknown as BoardStrings;

test("a hand-off label falls back to its key when the table is missing, not an object, or holds a non-string", () => {
  assert.equal(hl(table({}), "choose"), "choose");
  assert.equal(hl(table({ handoffLabels: "nope" }), "choose"), "choose");
  assert.equal(hl(table({ handoffLabels: { choose: 5 } }), "choose"), "choose");
  assert.equal(hl(table({ handoffLabels: { choose: "Pick" } }), "choose"), "Pick");
});

test("the choose box puts a title with replacement patterns in verbatim and escapes markup in it", () => {
  const t = table({ handoffLabels: { choose: "Choose {title}", chooseTip: "Tip" } });
  const plain = chooseBox(t, 3, "price $& $1 list");
  assert.ok(plain.includes('aria-label="Choose price $&#38; $1 list"'), plain);
  assert.ok(plain.includes('data-choose="3"'));
  const hostile = chooseBox(t, 4, EVIL);
  assert.ok(!hostile.includes("<img"), hostile);
  assert.ok(!hostile.includes('onerror="'), hostile);
});

test("the ready pill rounds a fractional count down and stays hidden below one", () => {
  const t = table({ handoffLabels: { ready: "{count} ready", readyTip: "tip" } });
  assert.ok(readyPill(t, 2.9).includes(">2 ready<"));
  assert.equal(readyPill(t, 0.9), "");
  assert.equal(readyPill(t, Number.POSITIVE_INFINITY), "");
});

test("the proposals pill rounds a fractional count down, hides below one, and escapes its label", () => {
  const t = table({ handoffLabels: { proposals: "<b>{count}</b>", proposalsTip: "tip" } });
  const html = proposalsPill(t, 4.7);
  assert.ok(html.includes("&#60;b&#62;4&#60;/b&#62;"), html);
  assert.equal(proposalsPill(t, 0.5), "");
  assert.equal(proposalsPill(t, Number.NaN), "");
});

test("proposal counts split High and Medium from Low, and an empty list counts zero of both", () => {
  assert.deepEqual(proposalCounts([]), { main: 0, low: 0 });
  assert.deepEqual(proposalCounts([{ confidence: "low" }, { confidence: "low" }]), { main: 0, low: 2 });
  assert.deepEqual(proposalCounts([{ confidence: "high" }, { confidence: "medium" }, { confidence: "low" }]), { main: 2, low: 1 });
});

test("a project label falls back to its key when the table holds a non-string", () => {
  assert.equal(label(table({ projectLabels: { open: 7 } }), "open"), "open");
  assert.equal(label(table({ projectLabels: "nope" }), "open"), "open");
});

test("the rollup of no projects is all zero, and a project with an unknown light counts as unverified", () => {
  assert.deepEqual(rollupCounts([]), { noGo: 0, unverified: 0, go: 0 });
  const odd = [{ light: "go" }, { light: "something-new" }] as unknown as BoardProject[];
  assert.deepEqual(rollupCounts(odd), { noGo: 0, unverified: 1, go: 1 });
});

test("a skipped folder row fills the cap into its reason and escapes the folder name", () => {
  const t = table({ polish: {}, projectLabels: { skippedShort: "skipped", skip_cap: "over the limit of {max}" } });
  const model = { projects: [], skipped: [{ name: EVIL, reason: "cap" }] } as unknown as BoardModel;
  const html = skippedBlock(model, t, 5);
  assert.ok(html.includes("over the limit of"), html);
  assert.ok(!html.includes("<img"), html);
  assert.equal(skippedBlock({ projects: [] } as unknown as BoardModel, t, 5), "");
});

test("the chat pills and notice bar draw nothing for their off states and escape their text", () => {
  const t = table({ polish: { chatActive: "<i>Active</i>", chatPause: "Pause", chatResume: "Resume" } });
  assert.equal(activePill(false, t), "");
  assert.ok(!activePill(true, t).includes("<i>"));
  assert.equal(pollPill(undefined, t), "");
  assert.ok(pollPill(true, t).includes("▶"));
  assert.equal(noticeBar(undefined), "");
  assert.equal(noticeBar(""), "");
  assert.ok(!noticeBar(EVIL).includes("<img"));
});

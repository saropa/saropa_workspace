// The count pills on a project card (plan section 19, defects 4 and 5): a zero count is never
// drawn, and a blocking document is counted once, in the red pill only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings } from "../../board/boardHtml";
import { BoardItem } from "../../board/boardModelParts";
import { itemCounts } from "../../board/boardHtmlRows";

// Every string key answers with its own name in brackets, so assertions read the pill class.
const t = new Proxy({} as unknown as BoardStrings, { get: (_o, k: string) => `[${k}]` });

// Only `status` and `blocks` matter to the counts; the rest of the item is never read.
const item = (status: "red" | "amber" | "purple", blocks: boolean): BoardItem => ({ status, blocks } as unknown as BoardItem);

// How many pills of one color the card drew.
const pills = (html: string, color: string): number => (html.match(new RegExp(`class="cp ${color}"`, "g")) ?? []).length;

test("a card with no open items draws no count pills at all", () => {
  assert.equal(itemCounts([], "app", t), "");
});

test("a zero count is left out: only amber items draw only the amber pill", () => {
  const html = itemCounts([item("amber", false), item("amber", false)], "app", t);
  assert.equal(pills(html, "amber"), 1);
  assert.equal(pills(html, "red"), 0);
  assert.equal(pills(html, "purple"), 0);
});

test("a blocking document is counted once, in the red pill, whatever its status", () => {
  // A purple (in progress) document that blocks the release must not also feed the purple pill.
  const html = itemCounts([item("purple", true)], "app", t);
  assert.equal(pills(html, "red"), 1);
  assert.equal(pills(html, "purple"), 0);
});

test("several blockers make one red pill, not one per document", () => {
  const html = itemCounts([item("red", true), item("amber", true), item("red", true)], "app", t);
  assert.equal(pills(html, "red"), 1);
  assert.equal(pills(html, "amber"), 0);
});

test("red, amber and purple pills come out in that order when all three apply", () => {
  const html = itemCounts([item("purple", false), item("amber", false), item("red", true)], "app", t);
  assert.ok(html.indexOf('class="cp red"') < html.indexOf('class="cp amber"'));
  assert.ok(html.indexOf('class="cp amber"') < html.indexOf('class="cp purple"'));
});

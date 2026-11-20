// ganttStrips (board/boardHtmlAsk.ts): which projects' strips a Gantt section draws. askStrip itself is covered by
// boardOrderAsk.test.ts. Pure: no vscode import. Written, not run by the build agent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ganttStrips } from "../../board/boardHtmlAsk";
import type { BoardStrings } from "../../board/boardHtmlUtil";
import type { BoardProject } from "../../board/boardModelParts";

// Every polish key reads back as "[key]" with its {count} filled in, so assertions name the key.
const t = { polish: new Proxy({}, { get: (_o, k: string) => `[${k}] {count}` }) } as unknown as BoardStrings;

// A project with only the fields the strips read.
const proj = (id: string, extra: Partial<BoardProject> = {}): BoardProject => ({ id, ...extra }) as BoardProject;

const asking = proj("app", { ask: { count: 3, fresh: false } as never });
const ordering = proj("lib", { orderAsk: { count: 2 } });
const quiet = proj("docs");

test("the unified section draws the strip of every asking project, indexed by position", () => {
  const html = ganttStrips("all", [asking, quiet, ordering], t);
  assert.match(html, /data-ask="0"/);
  assert.match(html, /data-order="2"/);
  assert.equal((html.match(/class="ask"/g) ?? []).length, 2);
});

test("a project's own section draws only that project's strip", () => {
  const html = ganttStrips("lib", [asking, quiet, ordering], t);
  assert.doesNotMatch(html, /data-ask="0"/);
  assert.match(html, /data-order="2"/);
});

test("a section for a project with nothing to ask draws nothing", () => {
  assert.equal(ganttStrips("docs", [asking, quiet, ordering], t), "");
  assert.equal(ganttStrips("all", [], t), "");
});

test("an unknown group id draws nothing", () => {
  assert.equal(ganttStrips("nope", [asking], t), "");
});

test("the strip fills the count into the text and escapes it", () => {
  const html = ganttStrips("app", [asking], t);
  assert.match(html, /\[askText\] 3/);
  const evil = { polish: { askText: '<b>"{count}' } } as unknown as BoardStrings;
  const out = ganttStrips("app", [asking], evil);
  assert.doesNotMatch(out, /<b>/);
});

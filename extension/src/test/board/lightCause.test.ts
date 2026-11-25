// The first cause shown beside a NO-GO or UNVERIFIED light, so a red or amber project with
// nothing open still says why. Pure: built from hand-made project literals.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardProject } from "../../board/boardModelParts";
import { lightCause } from "../../board/lightCause";
import { emptyCounts } from "../../board/types";
import { causeHtml } from "../../board/boardHtmlCause";
import type { BoardStrings } from "../../board/boardHtmlUtil";

// Only the fields lightCause reads are set; the cast keeps the fixture short.
const proj = (over: Partial<BoardProject>): BoardProject =>
  ({ id: "p", name: "P", light: "no-go", reasons: [], items: [], blocked: 0, blockedStopping: 0, counts: emptyCounts(), dependsOn: [], ...over }) as BoardProject;

test("returns nothing for a GO project", () => {
  assert.equal(lightCause(proj({ light: "go" })), undefined);
});

test("names a failing build before lint, with its detail", () => {
  const c = lightCause(proj({ health: { build: "failing", buildDetail: "exit 1", lint: "failing" } as BoardProject["health"] }));
  assert.deepEqual(c, { kind: "build", detail: "exit 1" });
});

test("names failing lint when nothing is open", () => {
  assert.equal(lightCause(proj({ health: { lint: "failing", lintDetail: "3 errors" } as BoardProject["health"] }))?.kind, "lint");
});

test("names waiting documents that stop the release", () => {
  assert.deepEqual(lightCause(proj({ blockedStopping: 2 })), { kind: "blocked", count: 2 });
});

test("names red documents when none is listed as stopping", () => {
  assert.deepEqual(lightCause(proj({ counts: { ...emptyCounts(), red: 4 } })), { kind: "red", count: 4 });
});

test("names the held scan for a NO-GO carried over from the accepted scan", () => {
  assert.equal(lightCause(proj({ reasons: ["baseline"] }))?.kind, "baselineRed");
});

test("UNVERIFIED names the unaccepted scan first", () => {
  assert.equal(lightCause(proj({ light: "unverified", reasons: ["unread", "baseline"] }))?.kind, "baseline");
});

test("UNVERIFIED counts documents with an unreadable severity", () => {
  const items = [{ severity: undefined }, { severity: "low" }, { severity: undefined }] as BoardProject["items"];
  assert.deepEqual(lightCause(proj({ light: "unverified", reasons: ["unread"], items })), { kind: "unread", count: 2 });
});

test("an answered project names only its pinned blocking items, not waiting or red documents", () => {
  const items = [{ blocks: true }] as BoardProject["items"];
  const c = lightCause(proj({ answered: true, blockedStopping: 2, counts: { ...emptyCounts(), red: 4 }, items }));
  assert.deepEqual(c, { kind: "items", count: 1 });
});

test("an answered project with no pinned blocker has no NO-GO cause to name from counts", () => {
  assert.equal(lightCause(proj({ answered: true, blockedStopping: 2, counts: { ...emptyCounts(), red: 4 } })), undefined);
});

test("a count of 1 uses the singular string, other counts the plural", () => {
  const t = { polish: { "cause.red": "{count} red documents", "cause.red.one": "1 red document" } } as unknown as BoardStrings;
  assert.ok(causeHtml({ kind: "red", count: 1 }, t).includes(">1 red document<"));
  assert.ok(causeHtml({ kind: "red", count: 4 }, t).includes(">4 red documents<"));
});

test("a described cause is hidden from the accessibility tree and carries the id", () => {
  const t = { polish: { "cause.lint": "Lint failing" } } as unknown as BoardStrings;
  const html = causeHtml({ kind: "lint" }, t, "gc1");
  assert.ok(html.includes('id="gc1"') && html.includes('aria-hidden="true"'));
});

test("the phrase escapes the detail and marks UNVERIFIED causes amber", () => {
  const t = { polish: { "cause.lint": "Lint failing", "cause.baseline": "Accept the scan", causeTip: "{cause}: {detail}" } } as unknown as BoardStrings;
  const red = causeHtml({ kind: "lint", detail: "<b>x</b>" }, t);
  assert.ok(red.includes('class="cause"') && !red.includes("<b>x</b>"));
  assert.ok(causeHtml({ kind: "baseline" }, t).includes('class="cause warn"'));
  assert.equal(causeHtml(undefined, t), "");
});

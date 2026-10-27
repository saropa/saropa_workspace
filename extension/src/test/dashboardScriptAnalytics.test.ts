// Tests for the Dashboard webview's Analytics tab.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, open, strings } from "./dashboardWebviewFixture";

test("the analytics tab is blank until data arrives, then lists totals, rankings, session and recent runs", () => {
  const page = open("analytics");
  assert.equal(page.byId("analytics").innerHTML, "");
  page.receive({
    type: "analytics",
    totals: { shortcuts: "12 shortcuts", runs: "340 runs" },
    mostRun: [{ name: "build", sub: "90 runs" }],
    session: [{ name: "test", detail: "ok 3x", ok: true }, { name: "lint", detail: "failed", ok: false }],
    recent: [{ name: "build", ago: "2 min ago", tag: "ci" }, { name: "docs", ago: "1 h ago" }],
  });
  const box = page.byId("analytics");
  const s = strings(page);
  assert.deepEqual(box.querySelectorAll("h2").map((h) => h.textContent), [s.analyticsHeading, s.mostRunHeading, s.sessionHeading, s.recentHeading]);
  assert.deepEqual(box.querySelectorAll("ol.rank li").map((li) => li.textContent), ["build — 90 runs"]);
  assert.deepEqual(box.querySelectorAll(".meta").map((m) => m.className + ":" + m.textContent), ["meta ok:ok 3x", "meta fail:failed", "meta:2 min ago ci", "meta:1 h ago"]);
  assert.equal(box.querySelectorAll(".tag").length, 1);
});

test("the analytics open-markdown link posts its message", () => {
  const page = open("analytics");
  page.receive({ type: "analytics", totals: { shortcuts: "a", runs: "b" } });
  page.takePosted();
  page.click(page.byId("openMd"));
  assert.deepEqual(page.takePosted(), [{ type: "openAnalyticsMarkdown" }]);
});

test("analytics shows a disabled or empty notice instead of the lists, escaped", () => {
  const page = open("analytics");
  page.receive({ type: "analytics", enabled: false, message: EVIL });
  assert.equal(page.one("#analytics .empty").textContent, EVIL);
  assert.equal(page.all("img").length, 0);
  page.receive({ type: "analytics", empty: "Nothing yet" });
  assert.equal(page.one("#analytics .empty").textContent, "Nothing yet");
  assert.equal(page.all("#analytics h2").length, 0);
});

test("analytics text from the host is escaped everywhere it is written", () => {
  const page = open("analytics");
  page.receive({
    type: "analytics",
    totals: { shortcuts: EVIL, runs: EVIL },
    mostRun: [{ name: EVIL, sub: EVIL }],
    session: [{ name: EVIL, detail: EVIL, ok: true }],
    recent: [{ name: EVIL, ago: EVIL, tag: EVIL }],
  });
  assert.equal(page.all("#analytics img").length, 0);
  assert.equal(page.one(".rank li").textContent, `${EVIL} — ${EVIL}`);
  assert.equal(page.one(".tag").textContent, EVIL);
});

// The whole page: the skeleton, the board in each state, the security headers and what
// the page must never carry. Import paths of the original module keep working.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, escapeHtml, renderBoard, renderSkeleton } from "../../board/boardHtml";
import { escapeHtml as fromUtil } from "../../board/boardHtmlUtil";
import { buildBoard } from "../../board/boardModel";
import { pathToGo } from "../../board/pathToGo";
import { BoardConfig, BoardStatus, Classified } from "../../board/types";

const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) => (k === "blocked" || k === "more" ? `${k} {count}` : `[${k}]`),
});

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [
    { id: "app", name: "App", path: "app", roots: [], ruleSets: [] },
    { id: "db", name: "Db", path: "db", roots: [], ruleSets: [] },
  ],
};

const row = (project: string, path: string, status: BoardStatus, note = ""): Classified => ({ project, path, status, kind: "", note });

test("the escape helper is the same function from either module", () => {
  assert.equal(escapeHtml, fromUtil);
});

test("the skeleton shows a busy page with the loading text and a nonce-only script policy", () => {
  const html = renderSkeleton(t, "abc123");
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'nonce-abc123'"));
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes("[loading]"));
  assert.equal(html.match(/class="vd"/g)?.length, 5);
  assert.ok(!html.includes("<script"), "no script runs before there is a result");
});

test("the page title is escaped", () => {
  const strings = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "title" ? "Board </title><script>x</script>" : "") });
  const html = renderSkeleton(strings, "n");
  assert.ok(!html.includes("</title><script>"));
  assert.ok(html.includes("&#60;/title&#62;"));
});

test("the board page has one nonce script, the policy header and the scan again menu entry", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red")], undefined, true);
  const html = renderBoard(m, t, "N0NCE", 9);
  assert.equal(html.match(/<script/g)?.length, 1);
  assert.ok(html.includes('<script nonce="N0NCE">'));
  assert.ok(html.includes("style-src 'unsafe-inline'; script-src 'nonce-N0NCE'"));
  assert.ok(html.includes('data-act="refresh"'));
  assert.ok(!html.includes('id="refresh"'), "no refresh button in the header");
  assert.ok(html.includes("const REV=9;"));
  assert.ok(html.includes('<body class="">'));
});

test("the page carries no file path or URL outside the row tooltips", () => {
  const m = buildBoard(cfg, [row("app", "secret/place/a.md", "red")], undefined, true, undefined, undefined, undefined, {
    outside: { chats: {}, groups: [{ id: "g", label: "L", items: [{ title: "T", url: "https://example.com/x" }] }] },
  });
  const html = renderBoard(m, t, "n");
  const attrs = [...html.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(attrs.every((a) => a !== "https://example.com/x"), "no attribute holds the link");
  assert.equal(/\bhref\s*=\s*"(?!#")/i.test(html), false, "the only href is the in-page # of a document link");
  const withoutTooltips = html.replace(/title="[^"]*"/g, "");
  assert.ok(!withoutTooltips.includes("secret/place"));
});

test("a stale page is dimmed and busy, and offers no accept", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red")], { baseline: true, findings: [], clean: false }, false);
  const html = renderBoard(m, t, "n", 0, { stale: true });
  assert.ok(html.includes('<body class="stale busy" aria-busy="true">'));
  assert.ok(!html.includes('id="accept"'));
  assert.ok(renderBoard(m, t, "n").includes('id="accept"'), "a fresh unaccepted scan offers it");
});

test("a loading page is marked and offers no accept either", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red")], { baseline: true, findings: [], clean: false }, false);
  const html = renderBoard(m, t, "n", 0, { loading: true });
  assert.ok(html.includes('<body class="loading busy" aria-busy="true">'));
  assert.ok(!html.includes('id="accept"'));
});

test("the safety hold banner shows its text and the accept button", () => {
  const m = buildBoard(cfg, [], { baseline: false, findings: [{ kind: "folder-gone", project: "app", text: "x" }], clean: false }, false);
  const html = renderBoard(m, t, "n");
  assert.ok(html.includes("[safetyHold]"));
  assert.ok(html.includes('id="accept"'));
  assert.ok(!html.includes("[baseline]"));
});

test("a calm board says all clear; blocked documents or open items take that away", () => {
  const calm = buildBoard(cfg, [], undefined, true);
  assert.ok(renderBoard(calm, t, "n").includes("[allClear]"));
  const blocked = buildBoard(cfg, [row("app", "docs/blocked/a.md", "amber", "blocked")], undefined, true);
  const html = renderBoard(blocked, t, "n");
  assert.ok(!html.includes("[allClear]"));
  assert.ok(html.includes("blocked 1"));
  const open = buildBoard(cfg, [row("app", "docs/b.md", "amber")], undefined, true);
  assert.ok(!renderBoard(open, t, "n").includes("[allClear]"));
});

test("items are sorted into the three lists by state", () => {
  const m = buildBoard(cfg, [row("app", "a/red.md", "red"), row("app", "a/purple.md", "purple"), row("app", "a/amber.md", "amber")], undefined, true);
  const html = renderBoard(m, t, "n");
  const at = (s: string): number => html.indexOf(s);
  assert.ok(at("[resolveNow]") < at("[inProgress]") && at("[inProgress]") < at("[workOn]"));
  assert.ok(at("red.md") < at("purple.md") && at("purple.md") < at("amber.md"));
});

test("path lists are drawn per project only when paths are given", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red")], undefined, true);
  const paths = m.projects.map((p) => pathToGo(m, p, { maxSteps: 8, canRun: () => false }));
  assert.ok(!renderBoard(m, t, "n").includes('class="ptg"'));
  const html = renderBoard(m, t, "n", 0, {}, paths);
  assert.equal(html.match(/<ol class="ptg"/g)?.length, 2);
  assert.ok(renderBoard(m, t, "n", 0, { stale: true }, paths).includes('data-live="0"'), "a stale page cannot act");
});

test("the since strip and the train row appear above the projects", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const html = renderBoard(m, t, "n", 0, {}, undefined, { heading: "Since then", lines: [{ text: "line one", details: [] }] }, [
    { key: "k", name: "Train", light: "go", members: [{ id: "app", name: "App", light: "go", label: "1" }], heldBy: [], cycle: false },
  ]);
  const at = (s: string): number => html.indexOf(s);
  assert.ok(at("Since then") > 0 && at("Since then") < at('class="vd train"') && at('class="vd train"') < at('App</b>'));
});

test("the sittings filter shows when the model has a sittings view, and no button hides it", () => {
  const without = buildBoard(cfg, [], undefined, true);
  assert.ok(!renderBoard(without, t, "n").includes('id="sit-panel"'));
  const withView = buildBoard(cfg, [], undefined, true, undefined, undefined, undefined, { sittings: { selection: { timeBox: "any", maxSteps: 5 }, onlyOwner: false } });
  const html = renderBoard(withView, t, "n");
  assert.ok(html.includes('<details class="box" id="sit-panel" data-sec="sittings" open>'));
  assert.equal(html.includes('id="sit-open"'), false);
  assert.equal(html.includes("sit-panel\" hidden"), false);
});

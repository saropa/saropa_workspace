// Release Board first screen: the light rules and the HTML. The light is honest: NO-GO
// for anything in a red folder, otherwise UNVERIFIED (GO needs evidence from step 6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../board/boardModel";
import { BoardStrings, escapeHtml, renderBoard } from "../../board/boardHtml";
import { BoardConfig, BoardStatus, Classified, emptyCounts } from "../../board/types";

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [
    { id: "low", name: "Low", path: "low", roots: [], ruleSets: [], importance: "low" },
    { id: "app", name: "App", path: "app", roots: [], ruleSets: [], importance: "high", dependsOn: ["db"] },
    { id: "db", name: "Db", path: "db", roots: [], ruleSets: [] },
  ],
};

function row(project: string, path: string, status: BoardStatus, extra: Partial<Classified> = {}): Classified {
  return { project, path, status, kind: "", note: "", ...extra };
}

const t: BoardStrings = new Proxy({} as BoardStrings, {
  get: (_o, k: string) => (k === "more" || k === "blocked" || k === "reasonGrey" ? `${k} {count}` : `[${k}]`),
});

test("anything in a red folder makes the project NO-GO", () => {
  const m = buildBoard(cfg, [row("app", "bugs/A.md", "red")], undefined, true);
  assert.equal(m.projects.find((p) => p.id === "app")!.light, "no-go");
});

test("with no blocker the light is UNVERIFIED, never GO, and says why", () => {
  const m = buildBoard(cfg, [row("db", "docs/x.md", "grey")], undefined, true);
  const p = m.projects.find((x) => x.id === "db")!;
  assert.equal(p.light, "unverified");
  assert.deepEqual(p.reasons, ["grey", "health"]);
  const first = buildBoard(cfg, [], undefined, false).projects[0];
  assert.ok(first.reasons.includes("baseline"));
});

test("blue, green and reference are never listed or shown; blocked amber collapses", () => {
  const rows = [
    row("app", "a/1.md", "green"),
    row("app", "a/2.md", "blue"),
    row("app", "a/3.md", "reference"),
    row("app", "docs/blocked/4.md", "amber", { note: "blocked" }),
    row("app", "docs/blocked/5.md", "amber", { note: "blocked" }),
    row("app", "docs/6.md", "amber"),
    row("app", "bugs/7.md", "purple"),
  ];
  const m = buildBoard(cfg, rows, undefined, true);
  const p = m.projects.find((x) => x.id === "app")!;
  assert.deepEqual(p.items.map((i) => i.path), ["bugs/7.md", "docs/6.md"], "purple before amber");
  assert.equal(p.blocked, 2);
  const html = renderBoard(m, t, "n");
  assert.ok(!html.includes("a/1"), "done work is not listed");
  assert.ok(html.includes("blocked 2"));
});

test("projects are ordered by importance and ids are stable and flat", () => {
  const m = buildBoard(cfg, [row("app", "bugs/a.md", "red"), row("db", "bugs/b.md", "red")], undefined, true);
  assert.deepEqual(m.projects.map((p) => p.id), ["app", "db", "low"]);
  assert.deepEqual(m.items.map((i) => i.id), [0, 1]);
  assert.equal(m.items[1].path, "bugs/b.md");
});

test("html: titles are escaped, the list is capped, accept shows only for an unaccepted scan", () => {
  const rows: Classified[] = [row("app", 'bugs/<img src=x onerror=alert(1)>.md', "red")];
  for (let i = 0; i < 40; i++) {
    rows.push(row("app", `bugs/B${i}.md`, "red"));
  }
  const m = buildBoard(cfg, rows, { baseline: true, findings: [], clean: false }, false);
  const html = renderBoard(m, t, "NONCE");
  assert.ok(!html.includes("<img src=x"), "markup in a file name is escaped");
  assert.ok(html.includes("&#60;img"));
  assert.ok(html.includes("more 11"), "41 items, 30 shown");
  assert.ok(html.includes('id="accept"'), "first scan must be accepted");
  assert.ok(html.includes("script-src 'nonce-NONCE'"));
  const accepted = buildBoard(cfg, rows, { baseline: true, findings: [], clean: false }, true);
  assert.ok(!renderBoard(accepted, t, "N").includes('id="accept"'));
  assert.equal(escapeHtml(`a&b"'<`), "a&#38;b&#34;&#39;&#60;");
});

test("a held scan keeps NO-GO when the accepted scan had red work", () => {
  const counts = (red: number) => ({ ...emptyCounts(), red });
  const prev = { version: 1 as const, takenAt: 1, projects: { app: { counts: counts(3), folders: {}, ruleCounts: {}, greyFolders: {}, files: {}, facts: {} } } };
  const held = buildBoard(cfg, [], undefined, false, undefined, prev);
  assert.equal(held.projects.find((p) => p.id === "app")!.light, "no-go");
  const accepted = buildBoard(cfg, [], undefined, true, undefined, prev);
  assert.equal(accepted.projects.find((p) => p.id === "app")!.light, "unverified");
});

test("the first screen carries no counts or sentences in visible text", () => {
  const m = buildBoard(cfg, [row("app", "bugs/A.md", "red")], undefined, true);
  const html = renderBoard(m, t, "n", 7);
  assert.ok(!/<span class="n">/.test(html));
  assert.ok(html.includes("const REV=7"));
});

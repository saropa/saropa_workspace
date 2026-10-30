// Hand to chat: the prompt carries the blocker, the file and the evidence, grows with the
// detail level, never holds an absolute path, and the page only ever sends indexes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardModel, buildBoard } from "../../board/boardModel";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { asDetail, asOpenChat, formatPrompt, itemTarget, lineTarget, stepTarget } from "../../board/handToChat";
import { PathToGo, pathToGo } from "../../board/pathToGo";
import { BoardConfig, Classified } from "../../board/types";

const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [{ id: "app", name: "App", path: "/abs/app", roots: [], ruleSets: [] }],
};

function row(path: string, status: Classified["status"]): Classified {
  return { project: "app", path, status, kind: "owner action", note: "" };
}

function model(): BoardModel {
  return buildBoard(cfg, [row("human/A_BLOCKER.md", "red"), row("docs/other.md", "amber")], undefined, true, undefined, undefined, {}, {});
}

test("settings values fall back to the defaults", () => {
  assert.equal(asDetail("full"), "full");
  assert.equal(asDetail("loud"), "standard");
  assert.equal(asDetail(undefined), "standard");
  assert.equal(asOpenChat("offer"), "offer");
  assert.equal(asOpenChat("always"), "never");
});

test("an item prompt names the blocker, the project and the file", () => {
  const m = model();
  const it = m.items.find((i) => i.status === "red");
  assert.ok(it);
  const text = formatPrompt(itemTarget(m, it), "standard");
  assert.match(text, /Blocker: /);
  assert.match(text, /Project: App/);
  assert.match(text, /File: human\/A_BLOCKER\.md/);
  assert.match(text, /Evidence:/);
  assert.match(text, /red folder/);
});

test("short leaves the evidence out and full adds the project facts", () => {
  const m = model();
  const t = itemTarget(m, m.items[0]);
  const short = formatPrompt(t, "short");
  const standard = formatPrompt(t, "standard");
  const full = formatPrompt(t, "full");
  assert.ok(!short.includes("Evidence:"));
  assert.ok(standard.includes("Evidence:") && !standard.includes("Context:"));
  assert.ok(full.includes("Context:") && full.includes("Project light:"));
  assert.ok(short.length < standard.length && standard.length < full.length);
});

test("a prompt never holds an absolute path", () => {
  const m = model();
  for (const level of ["short", "standard", "full"] as const) {
    assert.ok(!formatPrompt(itemTarget(m, m.items[0]), level).includes("/abs/app"));
  }
});

test("a waiting document is named, with exact singular and plural wording", () => {
  const rows = [row("a.md", "red"), row("b.md", "amber"), row("c.md", "amber")];
  const m = buildBoard(cfg, rows, undefined, true, undefined, undefined, {}, {});
  m.items[1].waitsOn = [m.items[0].id];
  m.items[0].blocksCount = 1;
  const one = formatPrompt(itemTarget(m, m.items[0]), "full");
  assert.ok(one.includes("- 1 open document waits on it\n"));
  assert.match(one, /Waiting on it: /);
  m.items[0].blocksCount = 2;
  const two = formatPrompt(itemTarget(m, m.items[0]), "standard");
  assert.ok(two.includes("- 2 open documents wait on it\n"));
});

test("a Sittings line uses the same singular and plural wording", () => {
  const m = model();
  const line = { project: "app", projectName: "App", path: "x.md", docTitle: "X", heading: "", line: 0, text: "t", needs: [], minutes: 5 };
  assert.ok(formatPrompt(lineTarget(m, { ...line, blocksCount: 1 }), "full").includes("- 1 open document waits on this document\n"));
  assert.ok(formatPrompt(lineTarget(m, { ...line, blocksCount: 3 }), "full").includes("- 3 open documents wait on this document\n"));
});

test("step headlines use real singular and plural", () => {
  const m = model();
  const p = m.projects[0];
  const head = (kind: "blocked" | "rules" | "unread", count: number): string => stepTarget(m, p, { kind, key: kind, count }).headline;
  assert.equal(head("blocked", 1), "1 document in blocked folders would stop the release");
  assert.equal(head("blocked", 2), "2 documents in blocked folders would stop the release");
  assert.equal(head("rules", 1), "1 document has no rule placing it");
  assert.equal(head("rules", 3), "3 documents have no rule placing them");
  assert.equal(head("unread", 1), "1 document could not be read, so its severity is unknown");
  assert.equal(head("unread", 2), "2 documents could not be read, so their severity is unknown");
});

test("steps without a file carry no file line", () => {
  const m = model();
  const p = m.projects[0];
  const path = pathToGo(m, p, { maxSteps: 20, canRun: () => false });
  const lint = path.steps.find((s) => s.kind === "lint");
  assert.ok(lint);
  const text = formatPrompt(stepTarget(m, p, lint), "full");
  assert.match(text, /Lint evidence is missing/);
  assert.ok(!text.includes("File:"));
});

test("a Sittings line carries its file and line", () => {
  const m = model();
  const text = formatPrompt(
    lineTarget(m, { project: "app", projectName: "App", path: "human/X.md", docTitle: "X", heading: "Phone", line: 12, text: "Test on the iPhone", needs: ["iPhone"], minutes: 10, blocksCount: 0 }),
    "standard"
  );
  assert.match(text, /Step: Test on the iPhone/);
  assert.match(text, /File: human\/X\.md:12/);
  assert.match(text, /Needs: iPhone/);
});

const t = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "handToChat" ? "Hand to chat" : `[${k}] {title} {count}`) });

test("the page draws a step button, and only indexes; document rows have none", () => {
  const m = model();
  const paths: PathToGo[] = m.projects.map((p) => pathToGo(m, p, { maxSteps: 20, canRun: () => false }));
  const html = renderBoard(m, t, "n", 1, {}, paths);
  assert.ok(!html.includes('data-hk="item"'), "a document row hands over from its menu");
  assert.match(html, /data-hk="step" data-p="0" data-s="\d+"/);
  assert.ok(!html.includes("/abs/app"));
  const amber = m.items.find((i) => i.status === "amber");
  assert.ok(amber);
  assert.ok(!html.includes(`data-hk="item" data-i="${amber.id}"`));
});

test("no button is drawn when the label is empty", () => {
  const off = new Proxy({} as BoardStrings, { get: (_o, k: string) => (k === "handToChat" ? "" : `[${k}]`) });
  assert.ok(!renderBoard(model(), off, "n", 1).includes('class="hb"'));
});

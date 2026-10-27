// The keyword line of the board and the options menu entry: shown by default, honest about a
// customized dictionary, and following the feature switch.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "../_stub/vscode";
import { renderBoard } from "../../board/boardHtml";
import { buildBoard } from "../../board/boardModel";
import { keywordLine, partsText } from "../../board/keywordMark";
import { optsMenu } from "../../board/boardHtmlMenus";
import { BoardConfig } from "../../board/types";
import { strings } from "../../views/boardStrings";

const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App", path: "app", roots: ["docs"], ruleSets: [] }] };
const model = (severity?: BoardConfig["severity"]) => buildBoard({ ...cfg, severity }, [], undefined, true);

beforeEach(() => __resetConfig());

test("the model carries what the rules file changes, and nothing for the shipped keywords", () => {
  assert.equal(model().severityCustom, undefined);
  assert.equal(model({ threshold: 3 }).severityCustom, undefined, "the shipped value is not a change");
  assert.deepEqual(model({ threshold: 5, phrases: { high: ["x"] } }).severityCustom, ["threshold", "phrases.high"]);
});

test("with the shipped keywords the line says so and offers the editor, with tooltips", () => {
  const html = keywordLine(model(), strings());
  assert.ok(html.includes("Severity uses the shipped keywords."));
  assert.ok(html.includes('data-kw="edit"'));
  assert.equal(html.includes('data-kw="restore"'), false);
  assert.equal(html.includes("Keywords customized by you"), false);
  assert.ok(html.includes("title="));
});

test("a customized dictionary is marked in plain words, names the parts, and offers Restore defaults", () => {
  const html = keywordLine(model({ threshold: 5, weights: { head: 4 }, phrases: { critical: ["x"] }, negation: ["no "] } as never), strings());
  assert.ok(html.includes("Keywords customized by you"));
  assert.ok(html.includes("threshold, weights, negation words, Critical phrases"), html);
  assert.ok(html.includes("greener or redder"));
  assert.ok(html.includes('data-kw="edit"') && html.includes('data-kw="restore"'));
});

test("text is escaped", () => {
  const t = { ...strings(), keywordLabels: { ...strings().keywordLabels!, markCustom: '<img src=x onerror="a">' } };
  const html = keywordLine(model({ threshold: 5 }), t);
  assert.equal(html.includes("<img"), false);
});

test("parts are named, in order, and an unknown one is shown as its key", () => {
  const t = strings();
  assert.equal(partsText(t, ["audience", "minBodyDensity", "phrases.low"]), "audience words, body density, Low phrases");
  assert.equal(partsText(t, ["other"]), "part_other");
});

test("with the editor switched off the plain line and the menu entry go, but the customized mark stays", () => {
  __setConfig("saropaWorkspace.releaseBoard.keywordEditor", "enabled", false);
  const t = strings();
  assert.equal(t.keywordLabels!.edit, "");
  assert.equal(keywordLine(model(), t), "");
  const html = keywordLine(model({ threshold: 5 }), t);
  assert.ok(html.includes("Keywords customized by you"));
  assert.equal(html.includes("data-kw="), false, "no button while the editor is off");
  assert.equal(optsMenu(t).includes('data-act="keywords"'), false);
});

test("the options menu has the entry with a tooltip, and the board page draws the line and its script", () => {
  const t = strings();
  const menu = optsMenu(t);
  assert.ok(menu.includes('data-act="keywords"') && menu.includes("Edit keywords and phrases"));
  const page = renderBoard(model({ threshold: 5 }), t, "n", 3);
  assert.ok(page.includes('class="kwline custom"'));
  assert.ok(page.includes("type:b.getAttribute('data-kw')==='edit'?'keywords':'keywordsRestore',rev:REV"));
});

test("a page built without the keyword text draws no line", () => {
  const { keywordLabels: _drop, ...t } = strings();
  assert.equal(keywordLine(model({ threshold: 5 }), t), "");
});

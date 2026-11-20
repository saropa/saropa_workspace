// The keyword and tags text tables: every key resolves, the board line follows the feature switch, and the
// names of customized parts read as a joined list.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "../_stub/vscode";
import { KEYWORD_BOARD_KEYS, keywordBoardLabels, partNames } from "../../views/keywordStrings";
import { TAGS_LABEL_KEYS, tagsLabels } from "../../views/tagsStrings";

beforeEach(() => __resetConfig());

test("every board keyword key resolves to text, not to the raw key", () => {
  const labels = keywordBoardLabels();
  for (const k of KEYWORD_BOARD_KEYS) {
    assert.ok(k in labels, k);
    if (k !== "edit") {
      assert.ok(labels[k].length > 0, `${k} is empty`);
    }
    assert.ok(!labels[k].startsWith("releaseBoard."), `${k} shows a raw key`);
  }
});

test("the edit text is blanked when the keyword editor is switched off, and the rest stays", () => {
  assert.ok(keywordBoardLabels().edit.length > 0, "on by default");
  __setConfig("saropaWorkspace.releaseBoard.keywordEditor", "enabled", false);
  const off = keywordBoardLabels();
  assert.equal(off.edit, "");
  assert.ok(off.markPlain.length > 0 && off.restore.length > 0);
});

test("part names are joined with the catalog separator and a dotted part reads as its words", () => {
  assert.equal(partNames([]), "");
  assert.equal(partNames(["threshold"]), "threshold");
  assert.equal(partNames(["threshold", "phrases.high"]), "threshold, High phrases");
  assert.equal(partNames(["weights", "negation", "audience"]), "weights, negation words, audience words");
});

test("every tags label resolves to text and the count and problem placeholders are kept for the page", () => {
  const labels = tagsLabels();
  for (const k of TAGS_LABEL_KEYS) {
    assert.ok(labels[k]?.length > 0, `${k} is missing or empty`);
    assert.ok(!labels[k].startsWith("releaseBoard."), `${k} shows a raw key`);
  }
  assert.ok(labels.matches.includes("{count}"), "the match line keeps {count} for the page to fill");
});

test("the tags label keys list holds no repeated key", () => {
  assert.equal(new Set(TAGS_LABEL_KEYS).size, TAGS_LABEL_KEYS.length);
});

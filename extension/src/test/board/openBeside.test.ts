// Open beside: which group a document from the board opens in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseDocumentColumn, parseOpenBeside } from "../../board/openBeside";
import { COLUMN_BESIDE } from "../../board/placement";

const base = { openBeside: true, placement: "beside" as const, boardColumn: 2, groupColumns: [1, 2], activeColumn: 2 };

test("the board's own group is never the target when another group exists", () => {
  assert.equal(chooseDocumentColumn(base), 1);
});

test("the active group is used when it is not the board's", () => {
  assert.equal(chooseDocumentColumn({ ...base, boardColumn: 1, groupColumns: [1, 2, 3], activeColumn: 3 }), 3);
});

test("the first other group is used when the board is active", () => {
  assert.equal(chooseDocumentColumn({ ...base, boardColumn: 1, groupColumns: [1, 2, 3], activeColumn: 1 }), 2);
});

test("a board alone in the window opens the document beside", () => {
  assert.equal(chooseDocumentColumn({ ...base, boardColumn: 1, groupColumns: [1], activeColumn: 1 }), COLUMN_BESIDE);
});

test("sameGroup keeps the editor's own choice", () => {
  assert.equal(chooseDocumentColumn({ ...base, placement: "sameGroup" }), undefined);
});

test("the switch off keeps the editor's own choice", () => {
  assert.equal(chooseDocumentColumn({ ...base, openBeside: false }), undefined);
});

test("an unknown board column keeps the editor's own choice", () => {
  assert.equal(chooseDocumentColumn({ ...base, boardColumn: undefined }), undefined);
});

test("only false turns the setting off", () => {
  assert.equal(parseOpenBeside(false), false);
  assert.equal(parseOpenBeside(true), true);
  assert.equal(parseOpenBeside(undefined), true);
});

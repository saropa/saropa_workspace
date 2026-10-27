// Unit tests for the in-memory scratchpad command: format choices and the document
// it opens.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __setPickHandler, __resetHandlers } from "./_stub/vscode";
import { newScratchpad } from "../commands/scratchpad";

const win = vscode.window as unknown as Record<string, unknown>;
const ws = vscode.workspace as unknown as Record<string, unknown>;
let created: unknown[];
let shown: unknown[];
let info: string[];
const saved: Record<string, unknown> = {};

beforeEach(() => {
  created = [];
  shown = [];
  info = [];
  saved.open = ws.openTextDocument;
  saved.show = win.showTextDocument;
  saved.info = win.showInformationMessage;
  ws.openTextDocument = async (arg: unknown): Promise<unknown> => (created.push(arg), { doc: arg });
  win.showTextDocument = async (doc: unknown, opts: unknown): Promise<void> => void shown.push([doc, opts]);
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
});

afterEach(() => {
  ws.openTextDocument = saved.open;
  win.showTextDocument = saved.show;
  win.showInformationMessage = saved.info;
  __resetHandlers();
});

test("offers five formats in a fixed order", async () => {
  let items: Array<{ label: string; languageId: string }> = [];
  __setPickHandler(async (i) => ((items = i as typeof items), undefined));
  await newScratchpad();
  assert.deepEqual(items.map((i) => i.languageId), ["markdown", "json", "sql", "javascript", "plaintext"]);
  assert.deepEqual(items.map((i) => i.label), ["Markdown", "JSON", "SQL", "JavaScript", "Plain text"]);
});

test("cancelling the picker opens nothing", async () => {
  __setPickHandler(async () => undefined);
  await newScratchpad();
  assert.deepEqual(created, []);
  assert.deepEqual(info, []);
});

test("picking a format opens an empty untitled document in that language, not as a preview", async () => {
  __setPickHandler(async (items) => (items as Array<{ languageId: string }>).find((i) => i.languageId === "sql"));
  await newScratchpad();
  assert.deepEqual(created, [{ language: "sql", content: "" }]);
  assert.equal(shown.length, 1);
  assert.deepEqual((shown[0] as unknown[])[1], { preview: false });
  assert.match(info[0], /^Opened a SQL scratchpad\./);
});

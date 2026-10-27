// Unit tests for adding comment / separator annotations and website shortcuts:
// prompts, URL normalization, scope selection and the success / failure toasts.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __setInputHandler, __resetHandlers } from "./_stub/vscode";
import { addAnnotation, addUrl } from "../commands/shortcutAnnotations";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

const win = vscode.window as unknown as Record<string, unknown>;
let info: string[];
let warn: string[];
let saved: { info: unknown; warn: unknown };

beforeEach(() => {
  info = [];
  warn = [];
  saved = { info: win.showInformationMessage, warn: win.showWarningMessage };
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showWarningMessage = (m: string): Promise<undefined> => (warn.push(m), Promise.resolve(undefined));
});

afterEach(() => {
  win.showInformationMessage = saved.info;
  win.showWarningMessage = saved.warn;
  __resetHandlers();
});

function store(ok = true) {
  const annotations: Array<{ kind: string; scope: string; label: string | undefined; after?: Shortcut }> = [];
  const urls: Array<{ url: string; scope: string; label: string | undefined; after?: Shortcut }> = [];
  const s = {
    addAnnotationShortcut: async (kind: string, scope: string, label: string | undefined, after?: Shortcut) => {
      annotations.push({ kind, scope, label, after });
      return ok;
    },
    addUrlShortcut: async (url: string, scope: string, label: string | undefined, after?: Shortcut) => {
      urls.push({ url, scope, label, after });
      return ok;
    },
  } as unknown as ShortcutStore;
  return { s, annotations, urls };
}

function sequence(...answers: Array<string | undefined>): void {
  let i = 0;
  __setInputHandler(async () => answers[i++]);
}

const anchor = { id: "a", path: "a.ts", scope: "global" } as Shortcut;

test("a separator needs no prompt and defaults to the project scope", async () => {
  const { s, annotations } = store();
  await addAnnotation(s, "separator", undefined);
  assert.deepEqual(annotations, [{ kind: "separator", scope: "project", label: undefined, after: undefined }]);
  assert.equal(info[0], "Added a separator to the shortcut list.");
});

test("a comment asks for its text and rejects blank text", async () => {
  let validate: ((v: string) => string | undefined) | undefined;
  __setInputHandler(async (opts) => {
    validate = (opts as { validateInput?: (v: string) => string | undefined }).validateInput;
    return "  Remember this  ";
  });
  const { s, annotations } = store();
  await addAnnotation(s, "comment", undefined);
  assert.match(validate!("  ")!, /Enter the comment text/);
  assert.equal(validate!("text"), undefined);
  assert.equal(annotations[0].label, "  Remember this  ");
  assert.match(info[0], /Remember this/);
});

test("cancelling the comment prompt adds nothing", async () => {
  sequence(undefined);
  const { s, annotations } = store();
  await addAnnotation(s, "comment", undefined);
  assert.deepEqual(annotations, []);
  assert.deepEqual(info.concat(warn), []);
});

test("an annotation placed after a shortcut takes that shortcut's scope", async () => {
  const { s, annotations } = store();
  await addAnnotation(s, "separator", anchor);
  assert.equal(annotations[0].scope, "global");
  assert.equal(annotations[0].after, anchor);
});

test("when the store refuses an annotation the user is warned, not told it worked", async () => {
  const { s } = store(false);
  await addAnnotation(s, "separator", undefined);
  assert.equal(warn.length, 1);
  assert.deepEqual(info, []);
});

test("a bare address gets https, and a scheme is preserved", async () => {
  const { s, urls } = store();
  sequence("example.com/docs", "Docs");
  await addUrl(s, "project", undefined);
  sequence("  http://localhost:3000  ", "Local");
  await addUrl(s, "project", undefined);
  sequence("mailto:me@example.com", "Mail");
  await addUrl(s, "project", undefined);
  assert.deepEqual(urls.map((u) => u.url), [
    "https://example.com/docs",
    "http://localhost:3000",
    "mailto:me@example.com",
  ]);
});

test("a website shortcut uses its label, falls back to the URL for the toast, and honors the anchor scope", async () => {
  const { s, urls } = store();
  sequence("example.com", "");
  await addUrl(s, "project", anchor);
  assert.equal(urls[0].scope, "global");
  assert.equal(urls[0].after, anchor);
  assert.match(info[0], /https:\/\/example\.com/);
  sequence("example.org", "Org site");
  await addUrl(s, "global", undefined);
  assert.equal(urls[1].scope, "global");
  assert.match(info[1], /Org site/);
});

test("cancelling either website prompt adds nothing", async () => {
  const { s, urls } = store();
  sequence(undefined);
  await addUrl(s, "project", undefined);
  sequence("example.com", undefined);
  await addUrl(s, "project", undefined);
  assert.deepEqual(urls, []);
  assert.deepEqual(info.concat(warn), []);
});

test("a refused website add warns", async () => {
  const { s } = store(false);
  sequence("example.com", "x");
  await addUrl(s, "project", undefined);
  assert.equal(warn.length, 1);
});

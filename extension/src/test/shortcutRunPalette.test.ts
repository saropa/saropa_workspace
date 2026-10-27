// Unit tests for the run palette's shortcut ordering and reference resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  TOP_SHORTCUT_SLOTS,
  orderedShortcuts,
  resolveShortcutRef,
  runTopShortcut,
} from "../commands/shortcutRunPalette";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

function sc(id: string, path: string, extra: Partial<Shortcut> = {}): Shortcut {
  return { id, path, scope: "project", ...extra } as Shortcut;
}

function store(project: Shortcut[], global: Shortcut[] = []): ShortcutStore {
  return { getProjectShortcuts: () => project, getGlobalShortcuts: () => global } as unknown as ShortcutStore;
}

const comment = sc("c", "", { action: { kind: "comment" } });
const separator = sc("s", "", { action: { kind: "separator" } });

test("five top slots are offered", () => {
  assert.equal(TOP_SHORTCUT_SLOTS, 5);
});

test("orderedShortcuts lists project then global and drops annotations", () => {
  const list = orderedShortcuts(store([sc("a", "a.ts"), comment, sc("b", "b.ts"), separator], [sc("g", "g.ts", { scope: "global" })]));
  assert.deepEqual(list.map((s) => s.id), ["a", "b", "g"]);
});

test("resolveShortcutRef matches by id first, then label, path and basename", () => {
  const s = store([
    sc("x1", "docs/readme.md", { label: "x2" }),
    sc("x2", "src/deep/file.ts", { label: "Deploy" }),
  ]);
  // "x2" is the label of the first shortcut but the id of the second: id wins.
  assert.equal(resolveShortcutRef(s, "x2")?.id, "x2");
  assert.equal(resolveShortcutRef(s, "Deploy")?.id, "x2");
  assert.equal(resolveShortcutRef(s, "docs/readme.md")?.id, "x1");
  assert.equal(resolveShortcutRef(s, "file.ts")?.id, "x2");
});

test("resolveShortcutRef trims input and rejects empty or non-string refs", () => {
  const s = store([sc("a", "a.ts")]);
  assert.equal(resolveShortcutRef(s, "  a  ")?.id, "a");
  assert.equal(resolveShortcutRef(s, ""), undefined);
  assert.equal(resolveShortcutRef(s, "   "), undefined);
  assert.equal(resolveShortcutRef(s, 5), undefined);
  assert.equal(resolveShortcutRef(s, undefined), undefined);
  assert.equal(resolveShortcutRef(s, "missing"), undefined);
});

test("resolveShortcutRef never resolves to an annotation", () => {
  const s = store([sc("note", "", { label: "Heading", action: { kind: "comment" } })]);
  assert.equal(resolveShortcutRef(s, "note"), undefined);
  assert.equal(resolveShortcutRef(s, "Heading"), undefined);
});

test("an empty slot tells the user instead of running anything", () => {
  const win = vscode.window as unknown as Record<string, unknown>;
  const orig = win.showInformationMessage;
  const shown: string[] = [];
  win.showInformationMessage = (m: string): Promise<undefined> => (shown.push(m), Promise.resolve(undefined));
  try {
    runTopShortcut(store([sc("a", "a.ts")]), 3);
  } finally {
    win.showInformationMessage = orig;
  }
  assert.equal(shown.length, 1);
  assert.match(shown[0], /3/);
});

// Unit tests for the explorer decoration provider: which files get a trend color
// after a lint/test sweep changes, and when change events fire.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { Uri } from "./_stub/vscode";
import { ShortcutDecorationProvider } from "../views/shortcutDecorations";
import { shortcutBadges } from "../exec/shortcutBadges";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

let shortcuts: Shortcut[];
let n = 0;
const ids: string[] = [];

function sc(extra: Partial<Shortcut> = {}): Shortcut {
  const id = `deco-${process.pid}-${++n}`;
  ids.push(id);
  return { id, path: `${id}.ts`, scope: "project", ...extra } as Shortcut;
}

function provider(): ShortcutDecorationProvider {
  const store = {
    getProjectShortcuts: () => shortcuts,
    getGlobalShortcuts: () => [],
    resolveUri: (s: Shortcut) => Uri.file(`/proj/${s.path}`),
  } as unknown as ShortcutStore;
  return new ShortcutDecorationProvider(store);
}

// Record a first and second sweep so a trend exists.
function sweep(s: Shortcut, before: number, after: number): void {
  shortcutBadges.record(s.id, { errors: before, at: 1 });
  shortcutBadges.record(s.id, { errors: after, at: 2 });
}

beforeEach(() => {
  shortcuts = [];
});

afterEach(() => {
  for (const id of ids.splice(0)) {
    shortcutBadges.clear(id);
  }
});

function collect(p: ShortcutDecorationProvider): Array<vscode.Uri | vscode.Uri[]> {
  const events: Array<vscode.Uri | vscode.Uri[]> = [];
  p.onDidChangeFileDecorations((e) => events.push(e));
  return events;
}

test("a file whose sweep changed is reported to the explorer", () => {
  const s = sc();
  shortcuts = [s];
  sweep(s, 5, 2);
  const p = provider();
  const events = collect(p);
  p.refresh();
  assert.equal(events.length, 1);
  assert.deepEqual((events[0] as vscode.Uri[]).map((u) => u.fsPath), [`/proj/${s.path}`]);
});

test("worse and better trends are both reported; an unchanged count is not", () => {
  const better = sc();
  const worse = sc();
  const same = sc();
  shortcuts = [better, worse, same];
  sweep(better, 5, 2);
  sweep(worse, 1, 4);
  sweep(same, 3, 3);
  const p = provider();
  const events = collect(p);
  p.refresh();
  const reported = (events[0] as vscode.Uri[]).map((u) => u.fsPath).sort();
  assert.deepEqual(reported, [`/proj/${better.path}`, `/proj/${worse.path}`].sort());
});

test("a shortcut with only one sweep, no sweep, masked, or not a file is skipped", () => {
  const once = sc();
  shortcutBadges.record(once.id, { errors: 1, at: 1 });
  const none = sc();
  const masked = sc({ masked: true });
  sweep(masked, 5, 1);
  const shell = sc({ action: { kind: "shell", shellCommand: "x" } });
  sweep(shell, 5, 1);
  shortcuts = [once, none, masked, shell];
  const p = provider();
  const events = collect(p);
  p.refresh();
  assert.equal(events.length, 0);
});

test("a file with no active trend has no decoration", () => {
  const s = sc();
  shortcuts = [s];
  sweep(s, 3, 3);
  const p = provider();
  p.refresh();
  assert.equal(p.provideFileDecoration(Uri.file(`/proj/${s.path}`) as unknown as vscode.Uri), undefined);
  assert.equal(p.provideFileDecoration(Uri.file("/proj/unknown.ts") as unknown as vscode.Uri), undefined);
});

test("when a trend disappears, the file is reported once more so its color clears", () => {
  const s = sc();
  shortcuts = [s];
  sweep(s, 5, 2);
  const p = provider();
  p.refresh();
  const events = collect(p);
  shortcutBadges.record(s.id, { errors: 2, at: 3 });
  p.refresh();
  assert.equal(events.length, 1);
  assert.equal((events[0] as vscode.Uri[]).length, 1);
});

test("refreshing with nothing to report fires nothing", () => {
  const p = provider();
  const events = collect(p);
  p.refresh();
  assert.equal(events.length, 0);
});

test("fewer issues tint the file green and more issues tint it red", () => {
  const better = sc();
  const worse = sc();
  shortcuts = [better, worse];
  sweep(better, 5, 2);
  sweep(worse, 1, 4);
  const p = provider();
  p.refresh();
  const colorOf = (s: Shortcut): string | undefined =>
    (p.provideFileDecoration(Uri.file(`/proj/${s.path}`) as unknown as vscode.Uri)?.color as unknown as { id: string } | undefined)?.id;
  assert.equal(colorOf(better), "charts.green");
  assert.equal(colorOf(worse), "errorForeground");
});

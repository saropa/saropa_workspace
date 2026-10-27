// Unit tests for the run palette's shortcut ordering and reference resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  TOP_SHORTCUT_SLOTS,
  orderedShortcuts,
  resolveShortcutRef,
  runAnyShortcut,
  runShortcutWithOverrides,
  runTopShortcut,
} from "../commands/shortcutRunPalette";
import { l10n } from "../i18n/l10n";
import { __resetHandlers, __setInputHandler, __setPickHandler } from "./_stub/vscode";
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
  assert.equal(shown[0], "No shortcut in position 3. Add or reorder shortcuts to fill it.");
});

// A store whose resolveUri records which shortcut a run reached. Returning undefined
// ends the run at the missing-file warning, so nothing is spawned.
function recordingStore(project: Shortcut[], global: Shortcut[] = [], groups: Array<{ id: string; label: string }> = []) {
  const reached: Shortcut[] = [];
  const base = store(project, global) as unknown as Record<string, unknown>;
  const full = {
    ...base,
    resolveUri: (s: Shortcut): undefined => (reached.push(s), undefined),
    findShortcut: (id: string): Shortcut | undefined => [...project, ...global].find((p) => p.id === id),
    getGroups: () => groups,
  } as unknown as ShortcutStore;
  return { store: full, reached };
}

let seq = 0;
const uid = (name: string): string => `${name}-${Date.now()}-${++seq}`;

function quiet(fn: () => Promise<void> | void): Promise<void> {
  const win = vscode.window as unknown as Record<string, unknown>;
  const orig = win.showWarningMessage;
  win.showWarningMessage = (): Promise<undefined> => Promise.resolve(undefined);
  return Promise.resolve(fn()).finally(() => {
    win.showWarningMessage = orig;
    __resetHandlers();
  });
}

test("a filled slot runs that exact shortcut, counted from one and skipping annotations", async () => {
  const [a, b, c] = [sc(uid("a"), "a.ts"), sc(uid("b"), "b.ts"), sc(uid("c"), "c.ts")];
  const { store: s, reached } = recordingStore([a, comment, b], [c]);
  await quiet(async () => {
    runTopShortcut(s, 1);
    runTopShortcut(s, 2);
    runTopShortcut(s, 3);
    await new Promise((r) => setImmediate(r));
  });
  assert.deepEqual(reached.map((r) => r.id), [a.id, b.id, c.id]);
});

test("run picker: items carry scope and group labels, and the chosen shortcut runs", async () => {
  const proj = sc(uid("p"), "p.ts", { groupId: "g1" });
  const glob = sc(uid("g"), "g.ts", { scope: "global" });
  const { store: s, reached } = recordingStore([proj], [glob], [{ id: "g1", label: "Build" }]);
  let seen: Array<{ description?: string; detail?: string }> = [];
  __setPickHandler(async (items) => {
    seen = items as typeof seen;
    return items[1];
  });
  await quiet(() => runAnyShortcut(s));
  assert.deepEqual(seen.map((i) => i.description), [`${l10n("pin.group.project")} / Build`, l10n("pin.group.global")]);
  assert.deepEqual(seen.map((i) => i.detail), ["p.ts", "g.ts"]);
  assert.deepEqual(reached.map((r) => r.id), [glob.id]);
});

test("run picker: a dismissed picker runs nothing and an empty set says so", async () => {
  const one = sc(uid("a"), "a.ts");
  const { store: s, reached } = recordingStore([one]);
  __setPickHandler(async () => undefined);
  await quiet(() => runAnyShortcut(s));
  assert.equal(reached.length, 0);

  const win = vscode.window as unknown as Record<string, unknown>;
  const orig = win.showInformationMessage;
  const shown: string[] = [];
  win.showInformationMessage = (m: string): Promise<undefined> => (shown.push(m), Promise.resolve(undefined));
  try {
    await runAnyShortcut(recordingStore([comment]).store);
  } finally {
    win.showInformationMessage = orig;
  }
  assert.deepEqual(shown, ["No shortcuts to run yet. Add a file as a shortcut first."]);
});

test("overrides: args are parsed, cwd trimmed and env split for this run only", async () => {
  const original = sc(uid("o"), "o.ts", { exec: { args: ["--old"], cwd: "stored", env: { K: "1" } } as Shortcut["exec"] });
  const { store: s, reached } = recordingStore([original]);
  const answers = ['--flag "two words" x', "  sub/dir  ", 'A=1 "B=x y" junk'];
  const prefills: Array<string | undefined> = [];
  __setPickHandler(async (items) => items[0]);
  __setInputHandler(async (opts) => (prefills.push(opts?.value), answers[prefills.length - 1]));
  await quiet(() => runShortcutWithOverrides(s));
  assert.equal(reached.length, 1);
  assert.equal(reached[0].id, original.id);
  assert.deepEqual(reached[0].exec?.args, ["--flag", "two words", "x"]);
  assert.equal(reached[0].exec?.cwd, "sub/dir");
  assert.deepEqual(reached[0].exec?.env, { A: "1", B: "x y" });
  assert.equal(prefills[1], "stored");
  assert.deepEqual(original.exec?.args, ["--old"], "the stored shortcut is untouched");
});

test("overrides: blank answers clear args, cwd and env; cancel at any step runs nothing", async () => {
  const original = sc(uid("o"), "o.ts", { exec: { args: ["--old"], cwd: "stored", env: { K: "1" } } as Shortcut["exec"] });
  const { store: s, reached } = recordingStore([original]);
  __setPickHandler(async (items) => items[0]);
  __setInputHandler(async () => "");
  await quiet(() => runShortcutWithOverrides(s));
  assert.equal(reached.length, 1);
  assert.deepEqual(
    [reached[0].exec?.args, reached[0].exec?.cwd, reached[0].exec?.env],
    [undefined, undefined, undefined]
  );

  for (const cancelAt of [0, 1, 2]) {
    let call = 0;
    __setInputHandler(async () => (call++ === cancelAt ? undefined : "x"));
    await quiet(() => runShortcutWithOverrides(s));
  }
  assert.equal(reached.length, 1);
});

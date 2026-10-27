// Unit tests for the activation helpers: the one-shot notice latch, the debouncer,
// run-on-save dispatch (direct match, watch globs, cooldown, paused) and the
// pinned-path context publisher.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  gatedNotice,
  makeDebounced,
  clearWatchLastRun,
  runShortcutsOnSave,
  syncShortcutPathContext,
  handleShortcutImportUri,
} from "../activation/activationHelpers";
import { fakeContext } from "./_stub/context";
import { encodeShortcutLink } from "../import/shareLink";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

type Stub = typeof vscode & {
  __recordedCommands(): ReadonlyArray<{ command: string; args: unknown[] }>;
  __resetRecordedCommands(): void;
  __setWorkspaceFolders(f: vscode.WorkspaceFolder[] | undefined): void;
};
const stub = vscode as Stub;

// The stub's workspace has no asRelativePath; install one that strips a root prefix.
const workspaceBag = vscode.workspace as unknown as Record<string, unknown>;
const ROOT = "/proj";

beforeEach(() => {
  stub.__resetRecordedCommands();
  workspaceBag.asRelativePath = (u: { fsPath: string }): string =>
    u.fsPath.startsWith(ROOT + "/") ? u.fsPath.slice(ROOT.length + 1) : u.fsPath;
});

afterEach(() => {
  delete workspaceBag.asRelativePath;
});

function runCalls(): Array<{ id: string; background: boolean }> {
  return stub
    .__recordedCommands()
    .filter((c) => c.command === "saropaWorkspace.runPin")
    .map((c) => {
      const s = c.args[0] as Shortcut;
      const bg = s.exec?.runLocation === "background" || s.action?.useIntegratedTerminal === false;
      return { id: s.id, background: bg };
    });
}

function fileShortcut(id: string, rel: string, extra: Partial<Shortcut> = {}): Shortcut {
  return { id, path: rel, scope: "project", exec: { command: "node", runOnSave: true }, ...extra } as Shortcut;
}

function storeOf(shortcuts: Shortcut[], global: Shortcut[] = []): ShortcutStore {
  return {
    getProjectShortcuts: () => shortcuts,
    getGlobalShortcuts: () => global,
    // The stub Uri has no `.path`; the real one mirrors fsPath on POSIX.
    resolveUri: (s: Shortcut) => ({ fsPath: `${ROOT}/${s.path}`, path: `${ROOT}/${s.path}` }),
  } as unknown as ShortcutStore;
}

const saved = (rel: string): vscode.Uri => vscode.Uri.file(`${ROOT}/${rel}`);

test("gatedNotice runs check then show once and latches the key", async () => {
  const mem = fakeContext().workspaceState;
  const shown: number[] = [];
  await gatedNotice(mem, "k", () => 42, (v) => void shown.push(v));
  await gatedNotice(mem, "k", () => 43, (v) => void shown.push(v));
  assert.deepEqual(shown, [42]);
  assert.equal(mem.get("k"), true);
});

test("gatedNotice does not latch when the check yields undefined", async () => {
  const mem = fakeContext().workspaceState;
  let shown = 0;
  await gatedNotice(mem, "k", () => undefined, () => void shown++);
  assert.equal(shown, 0);
  assert.equal(mem.get("k"), undefined);
  await gatedNotice(mem, "k", async () => "now", () => void shown++);
  assert.equal(shown, 1);
});

test("gatedNotice skips the check entirely once latched", async () => {
  const mem = fakeContext().workspaceState;
  await mem.update("k", true);
  let checked = 0;
  await gatedNotice(mem, "k", () => void checked++, () => {});
  assert.equal(checked, 0);
});

test("a falsy but defined check value (0, empty string) still shows and latches", async () => {
  const mem = fakeContext().workspaceState;
  const shown: unknown[] = [];
  await gatedNotice(mem, "z", () => 0, (v) => void shown.push(v));
  assert.deepEqual(shown, [0]);
});

test("makeDebounced collapses a burst into one trailing call", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let calls = 0;
    const d = makeDebounced(() => void calls++, 100);
    d();
    mock.timers.tick(60);
    d();
    mock.timers.tick(60);
    assert.equal(calls, 0);
    mock.timers.tick(40);
    assert.equal(calls, 1);
  } finally {
    mock.timers.reset();
  }
});

test("makeDebounced.cancel drops the pending call and is safe to repeat", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let calls = 0;
    const d = makeDebounced(() => void calls++, 100);
    d();
    d.cancel();
    d.cancel();
    mock.timers.tick(500);
    assert.equal(calls, 0);
  } finally {
    mock.timers.reset();
  }
});

test("run-on-save fires a file shortcut whose resolved path is the saved file", () => {
  runShortcutsOnSave(storeOf([fileShortcut("a", "src/a.js"), fileShortcut("b", "src/b.js")]), saved("src/a.js"));
  assert.deepEqual(runCalls(), [{ id: "a", background: false }]);
});

test("run-on-save ignores paused shortcuts and those without runOnSave", () => {
  const paused = fileShortcut("p", "x.js", { paused: true });
  const off = fileShortcut("o", "x.js", { exec: { command: "node" } });
  runShortcutsOnSave(storeOf([paused, off]), saved("x.js"));
  assert.deepEqual(runCalls(), []);
});

test("run-on-save covers global shortcuts and skips non-file kinds", () => {
  const shell = { id: "s", path: "", scope: "project", action: { kind: "shell", shellCommand: "x" }, exec: { runOnSave: true } } as Shortcut;
  runShortcutsOnSave(storeOf([shell], [fileShortcut("g", "g.js", { scope: "global" })]), saved("g.js"));
  assert.deepEqual(runCalls(), [{ id: "g", background: false }]);
});

test("watch globs fire in the background on a relative or absolute match", () => {
  const watcher = (id: string, glob: string): Shortcut =>
    ({ id, path: "", scope: "project", action: { kind: "shell", shellCommand: "echo" }, exec: { runOnSaveGlobs: [glob] } }) as Shortcut;
  clearWatchLastRun("w1");
  clearWatchLastRun("w2");
  clearWatchLastRun("w3");
  runShortcutsOnSave(
    storeOf([watcher("w1", "src/*.ts"), watcher("w2", "/proj/src/**"), watcher("w3", "docs/*.md")]),
    saved("src/main.ts")
  );
  assert.deepEqual(runCalls(), [
    { id: "w1", background: true },
    { id: "w2", background: true },
  ]);
});

test("a watch glob does not double-fire a shortcut already run directly", () => {
  const both = fileShortcut("d", "src/a.js", { exec: { command: "node", runOnSave: true, runOnSaveGlobs: ["src/*.js"] } });
  clearWatchLastRun("d");
  runShortcutsOnSave(storeOf([both]), saved("src/a.js"));
  assert.equal(runCalls().length, 1);
});

test("a watch glob is rate-limited by a cooldown until cleared", () => {
  const w = { id: "cd", path: "", scope: "project", action: { kind: "shell", shellCommand: "echo" }, exec: { runOnSaveGlobs: ["*.ts"] } } as Shortcut;
  clearWatchLastRun("cd");
  const store = storeOf([w]);
  runShortcutsOnSave(store, saved("a.ts"));
  runShortcutsOnSave(store, saved("a.ts"));
  assert.equal(runCalls().length, 1);
  clearWatchLastRun("cd");
  runShortcutsOnSave(store, saved("a.ts"));
  assert.equal(runCalls().length, 2);
});

test("syncShortcutPathContext publishes resolved file paths for each scope", () => {
  const store = storeOf(
    [fileShortcut("a", "a.js"), { id: "u", path: "", scope: "project", action: { kind: "url", url: "http://x" } } as Shortcut],
    [fileShortcut("g", "g.js")]
  );
  syncShortcutPathContext(store);
  const ctx = Object.fromEntries(
    stub.__recordedCommands().filter((c) => c.command === "setContext").map((c) => [c.args[0], c.args[1]])
  );
  assert.deepEqual(ctx["saropaWorkspace.projectPinnedPaths"], { "/proj/a.js": true });
  assert.deepEqual(ctx["saropaWorkspace.globalPinnedPaths"], { "/proj/g.js": true });
});

// Capture the toast calls the stub otherwise discards.
function captureToasts(answer: string | undefined): { info: string[]; warn: string[]; restore(): void } {
  const win = vscode.window as unknown as Record<string, unknown>;
  const origInfo = win.showInformationMessage;
  const origWarn = win.showWarningMessage;
  const info: string[] = [];
  const warn: string[] = [];
  win.showInformationMessage = (m: string, ...rest: unknown[]): Promise<string | undefined> => {
    info.push(m);
    // The confirm dialog passes (message, options, action); echo the action to accept.
    return Promise.resolve(answer === "accept" ? (rest[rest.length - 1] as string) : undefined);
  };
  win.showWarningMessage = (m: string): Promise<undefined> => {
    warn.push(m);
    return Promise.resolve(undefined);
  };
  return {
    info,
    warn,
    restore: (): void => {
      win.showInformationMessage = origInfo;
      win.showWarningMessage = origWarn;
    },
  };
}

function importUri(path: string, query: string): vscode.Uri {
  return { path, query } as unknown as vscode.Uri;
}

test("handleShortcutImportUri ignores URIs that are not /import", async () => {
  const t = captureToasts("accept");
  try {
    await handleShortcutImportUri(importUri("/other", ""), {} as ShortcutStore);
    assert.deepEqual(t.info.concat(t.warn), []);
  } finally {
    t.restore();
  }
});

test("handleShortcutImportUri warns on undecodable data", async () => {
  const t = captureToasts("accept");
  try {
    await handleShortcutImportUri(importUri("/import", "data=%%%"), {} as ShortcutStore);
    assert.equal(t.warn.length, 1);
    assert.equal(t.info.length, 0);
  } finally {
    t.restore();
  }
});

test("handleShortcutImportUri imports into the project scope when the user accepts", async () => {
  const link = encodeShortcutLink({ id: "x", path: "", scope: "project", label: "Deploy", action: { kind: "shell", shellCommand: "ls" } } as Shortcut);
  const data = new URL(link.startsWith("http") || link.includes("://") ? link : `vscode://x/import?${link}`).searchParams.get("data");
  assert.ok(data, "encoded link carries data");
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(ROOT), name: "p", index: 0 }]);
  const calls: string[] = [];
  const store = { importShortcut: async (_s: unknown, scope: string) => (calls.push(scope), true) } as unknown as ShortcutStore;
  const t = captureToasts("accept");
  try {
    await handleShortcutImportUri(importUri("/import", `data=${encodeURIComponent(data)}`), store);
    assert.deepEqual(calls, ["project"]);
    assert.match(t.info[t.info.length - 1], /Deploy/);
  } finally {
    t.restore();
    stub.__setWorkspaceFolders(undefined);
  }
});

test("handleShortcutImportUri imports nothing when the user declines", async () => {
  const link = encodeShortcutLink({ id: "x", path: "", scope: "project", label: "Deploy", action: { kind: "shell", shellCommand: "ls" } } as Shortcut);
  const data = new URL(link.includes("://") ? link : `vscode://x/import?${link}`).searchParams.get("data")!;
  let imported = 0;
  const store = { importShortcut: async () => (imported++, true) } as unknown as ShortcutStore;
  const t = captureToasts(undefined);
  try {
    await handleShortcutImportUri(importUri("/import", `data=${encodeURIComponent(data)}`), store);
    assert.equal(imported, 0);
  } finally {
    t.restore();
  }
});

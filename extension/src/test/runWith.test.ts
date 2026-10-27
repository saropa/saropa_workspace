// Tests for "Run with...": the guards, the interpreter list, and that the chosen
// interpreter is persisted over the existing run settings.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setPickHandler,
  __setOpenDialogHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { runWith } from "../commands/runWith";
import { processRegistry } from "../exec/processRegistry";
import { clearInterpreterCache } from "../exec/interpreterDetect";
import type { Shortcut } from "../model/shortcut";

interface Row {
  label: string;
  description?: string;
  detail?: string;
  kind?: number;
  choice: { kind: string; command?: string; display?: string };
}

let dir: string;
let store: ShortcutStore;
let blocker: EventEmitter | undefined;
let realPath: string | undefined;

async function addShortcut(file: string, exec?: Shortcut["exec"]): Promise<Shortcut> {
  nodeFs.writeFileSync(nodePath.join(dir, file), "x");
  await store.addShortcut(Uri.file(`${dir}/${file}`) as never, "project");
  const found = store.getProjectShortcuts().find((p) => !p.isAuto && p.path === file)!;
  if (exec) {
    await store.updateShortcutExec(found, exec);
  }
  return store.findShortcut(found.id)!;
}

// A fake tracked process, so the run that follows the pick is stopped by the
// "already running" guard instead of starting anything.
function holdRunning(id: string): void {
  blocker = new EventEmitter();
  processRegistry.register(id, blocker as unknown as ChildProcess);
}

function pickLabel(match: (row: Row) => boolean, seen: Row[][] = []): void {
  __setPickHandler(async (items) => {
    seen.push([...items] as Row[]);
    return (items as Row[]).find(match);
  });
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-runwith-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  clearInterpreterCache();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  blocker?.emit("close");
  blocker = undefined;
  if (realPath !== undefined) {
    process.env.PATH = realPath;
    realPath = undefined;
  }
  clearInterpreterCache();
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("a shortcut that is not a plain file or is an annotation is refused", async () => {
  const recipe = { id: "r", scope: "project", path: "", order: 0, action: { kind: "url", target: "https://x.test" } } as unknown as Shortcut;
  const note = { id: "n", scope: "project", path: "", order: 1, action: { kind: "comment" } } as unknown as Shortcut;
  await runWith(store, recipe);
  await runWith(store, note);
  assert.deepEqual(__infoMessages(), ["Only a file shortcut runs through an interpreter.", "Only a file shortcut runs through an interpreter."]);
});

test("a shortcut whose file cannot be resolved warns with its path", async () => {
  const lost = { id: "lost", scope: "project", path: "gone/x.sh", order: 0 } as Shortcut;
  await runWith(store, lost);
  assert.deepEqual(__warningMessages(), ["File not found: gone/x.sh"]);
});

test("a type with no known interpreter lists the three fixed choices after a separator", async () => {
  const shortcut = await addShortcut("notes.zzz");
  const seen: Row[][] = [];
  pickLabel(() => false, seen);
  await runWith(store, shortcut);
  const rows = seen[0];
  assert.deepEqual(rows.map((r) => [r.kind ?? 0, r.label]), [
    [-1, ""],
    [0, "$(settings-gear) Use the default for this file type"],
    [0, "$(run) Run directly"],
    [0, "$(folder-opened) Browse for an interpreter…"],
  ]);
  assert.deepEqual(rows.slice(1).map((r) => r.choice), [
    { kind: "set", command: undefined, display: "Default" },
    { kind: "set", command: "", display: "Run directly" },
    { kind: "browse" },
  ]);
  assert.equal(shortcut.exec, undefined, "dismissing the pick changes nothing");
});

test("choosing the default clears the interpreter but keeps the other run settings", async () => {
  const shortcut = await addShortcut("notes.zzz", { command: "python", args: "--fast", cwd: "sub" } as never);
  holdRunning(shortcut.id);
  pickLabel((r) => r.label.includes("Use the default"));
  await runWith(store, shortcut);
  const stored = store.findShortcut(shortcut.id)!;
  assert.deepEqual({ ...stored.exec }, { args: "--fast", cwd: "sub" });
  assert.deepEqual(__infoMessages(), ["Updated how notes.zzz runs: Default"]);
  assert.equal(__warningMessages().length, 1, "the follow-up run is stopped by the already-running guard");
});

test("choosing Run directly stores an empty command", async () => {
  const shortcut = await addShortcut("notes.zzz");
  holdRunning(shortcut.id);
  pickLabel((r) => r.label.includes("Run directly"));
  await runWith(store, shortcut);
  assert.equal(store.findShortcut(shortcut.id)!.exec?.command, "");
  assert.deepEqual(__infoMessages(), ["Updated how notes.zzz runs: Run directly"]);
});

test("browsing stores the chosen executable, quoted when its path has a space", async () => {
  const shortcut = await addShortcut("notes.zzz");
  holdRunning(shortcut.id);
  pickLabel((r) => r.choice.kind === "browse");
  __setOpenDialogHandler(async () => [Uri.file("/opt/my tools/interp")]);
  await runWith(store, shortcut);
  assert.equal(store.findShortcut(shortcut.id)!.exec?.command, '"/opt/my tools/interp"');
  assert.deepEqual(__infoMessages(), ["Updated how notes.zzz runs: interp"]);
});

test("browsing to a path without spaces stores it as is, and a canceled dialog changes nothing", async () => {
  const shortcut = await addShortcut("notes.zzz");
  holdRunning(shortcut.id);
  pickLabel((r) => r.choice.kind === "browse");
  __setOpenDialogHandler(async () => []);
  await runWith(store, shortcut);
  assert.equal(store.findShortcut(shortcut.id)!.exec, undefined);
  assert.deepEqual(__infoMessages(), []);
  __setOpenDialogHandler(async () => [Uri.file("/opt/interp")]);
  await runWith(store, shortcut);
  assert.equal(store.findShortcut(shortcut.id)!.exec?.command, "/opt/interp");
});

test("an interpreter found on PATH is listed first with its path, and the current one is ticked", {
  skip: process.platform === "win32",
}, async () => {
  const bin = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bin-"));
  try {
    nodeFs.writeFileSync(nodePath.join(bin, "node"), "#!/bin/sh\n", { mode: 0o755 });
    realPath = process.env.PATH;
    process.env.PATH = bin;
    const shortcut = await addShortcut("tool.js", { command: "node" } as never);
    const seen: Row[][] = [];
    pickLabel(() => false, seen);
    await runWith(store, shortcut);
    const first = seen[0][0];
    assert.equal(first.label, "$(check) node");
    assert.equal(first.description, "node");
    assert.equal(first.detail, nodePath.join(bin, "node"));
    assert.deepEqual(first.choice, { kind: "set", command: "node", display: "node" });
  } finally {
    nodeFs.rmSync(bin, { recursive: true, force: true });
  }
});

test("a detected interpreter that is not the current one has no tick", {
  skip: process.platform === "win32",
}, async () => {
  const bin = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bin-"));
  try {
    nodeFs.writeFileSync(nodePath.join(bin, "node"), "#!/bin/sh\n", { mode: 0o755 });
    realPath = process.env.PATH;
    process.env.PATH = bin;
    const shortcut = await addShortcut("tool.js");
    const seen: Row[][] = [];
    pickLabel(() => false, seen);
    await runWith(store, shortcut);
    assert.equal(seen[0][0].label, "node");
  } finally {
    nodeFs.rmSync(bin, { recursive: true, force: true });
  }
});

// Tests for "New routine from selection": which selected rows become members, the
// prompts, and what is saved.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  __setInputHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { ShortcutStore } from "../model/shortcutStore";
import { newRoutineFromSelection } from "../commands/routineFromSelection";

let dir: string;
let store: ShortcutStore;

function row(id: string, extra: Record<string, unknown> = {}): unknown {
  return { id, scope: "project", path: `/p/${id}.sh`, order: 0, ...extra };
}

function saved() {
  return store.getProjectShortcuts().filter((p) => !p.isAuto);
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-routine-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  store = new ShortcutStore(fakeContext());
  await store.init();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("fewer than two usable rows warns and saves nothing", async () => {
  await newRoutineFromSelection(store, row("a"), [row("a")]);
  assert.deepEqual(__warningMessages(), ["Select at least two shortcuts (Ctrl/Cmd-click) to compose into a routine."]);
  assert.deepEqual(saved(), []);
});

test("members keep selection order and use the recipe id when there is one", async () => {
  __setInputHandler(async () => "  Nightly  ");
  const a = row("a", { label: "Alpha" });
  const b = row("b", { recipeId: "recipe.b", label: "Beta" });
  const c = row("c");
  await newRoutineFromSelection(store, a, [b, a, c]);
  const [routine] = saved();
  assert.equal(routine.label, "Nightly");
  assert.deepEqual(routine.action, {
    kind: "routine",
    members: [
      { recipeId: "recipe.b", label: "Beta" },
      { pinId: "a", label: "Alpha" },
      { pinId: "c" },
    ],
  });
  assert.equal(routine.icon, "run-all");
  assert.equal(routine.color, "charts.green");
  assert.deepEqual(__infoMessages(), ['Created routine "Nightly" with 3 members. Double-click to run them in sequence.']);
});

test("duplicates, routines, comments, separators and non-shortcut values are dropped", async () => {
  __setInputHandler(async () => "R");
  const rows = [
    row("a"),
    row("a"),
    row("r", { action: { kind: "routine", members: [] } }),
    row("note", { action: { kind: "comment" } }),
    row("sep", { action: { kind: "separator" } }),
    { nothing: true },
    "text",
    row("b"),
  ];
  await newRoutineFromSelection(store, undefined, rows);
  const members = (saved()[0].action as { members: Array<{ pinId: string }> }).members;
  assert.deepEqual(members.map((m) => m.pinId), ["a", "b"]);
});

test("a recipe row and a stored row sharing the id of its recipe count once", async () => {
  __setInputHandler(async () => "R");
  const first = row("x1", { recipeId: "same", label: "One" });
  const second = row("x2", { recipeId: "same", label: "Two" });
  await newRoutineFromSelection(store, first, [first, second, row("y")]);
  const members = (saved()[0].action as { members: unknown[] }).members;
  assert.deepEqual(members, [{ recipeId: "same", label: "One" }, { pinId: "y" }]);
});

test("when no multi-selection array is passed the clicked row alone is used, which is too few", async () => {
  await newRoutineFromSelection(store, row("a"), []);
  assert.equal(__warningMessages().length, 1);
});

test("canceling the name prompt saves nothing and shows no message", async () => {
  await newRoutineFromSelection(store, row("a"), [row("a"), row("b")]);
  assert.deepEqual(saved(), []);
  assert.deepEqual(__infoMessages(), []);
});

test("the name prompt shows the member count, the default name and rejects a blank name", async () => {
  let seen: { prompt?: string; value?: string; validateInput?: (v: string) => string | undefined } | undefined;
  __setInputHandler(async (opts) => {
    seen = opts as typeof seen;
    return undefined;
  });
  await newRoutineFromSelection(store, row("a"), [row("a"), row("b")]);
  assert.equal(seen?.prompt, "Name this routine (2 members, run in sequence)");
  assert.equal(seen?.value, "My routine");
  assert.equal(seen?.validateInput?.("   "), "Enter a name for the routine.");
  assert.equal(seen?.validateInput?.(" ok "), undefined);
});

test("with no folder open the routine is saved as a global shortcut", async () => {
  __setWorkspaceFolders(undefined);
  __setInputHandler(async () => "G");
  await newRoutineFromSelection(store, row("a"), [row("a"), row("b")]);
  assert.deepEqual(store.getGlobalShortcuts().filter((p) => !p.isAuto).map((p) => p.label), ["G"]);
});

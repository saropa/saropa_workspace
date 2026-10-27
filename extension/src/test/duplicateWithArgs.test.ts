// Unit tests for "duplicate with argument": the argument prompt, the suggested name
// (which swaps rather than stacks the previous argument suffix), cancel paths and
// the success/failure toasts.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __setInputHandler, __resetHandlers } from "./_stub/vscode";
import { duplicateWithArgs } from "../commands/duplicateWithArgs";
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

type Opts = { value?: string; validateInput?: (v: string) => string | undefined } | undefined;

// Answers the argument prompt first, then the name prompt; records what each showed.
function answers(argLine: string | undefined, name: string | undefined): { prompts: Opts[] } {
  const prompts: Opts[] = [];
  let call = 0;
  __setInputHandler(async (opts) => {
    prompts.push(opts as Opts);
    return call++ === 0 ? argLine : name;
  });
  return { prompts };
}

function store(created = true) {
  const calls: Array<{ name: string; args: string[] }> = [];
  const s = {
    duplicateShortcut: async (_s: Shortcut, name: string, args: string[]) => {
      calls.push({ name, args });
      return created;
    },
  } as unknown as ShortcutStore;
  return { s, calls };
}

const file = (extra: Partial<Shortcut> = {}): Shortcut =>
  ({ id: "f", path: "scripts/run.py", scope: "project", ...extra }) as Shortcut;

test("a non-file shortcut is refused before any prompt", async () => {
  const { prompts } = answers("x", "y");
  const { s, calls } = store();
  await duplicateWithArgs(s, file({ action: { kind: "shell", shellCommand: "ls" } }));
  assert.equal(prompts.length, 0);
  assert.equal(calls.length, 0);
  assert.match(warn[0], /not a file shortcut/);
});

test("the argument prompt starts from the current arguments, quoting spaced ones", async () => {
  const { prompts } = answers(undefined, undefined);
  await duplicateWithArgs(store().s, file({ exec: { args: ["-o", "my file"] } }));
  assert.equal(prompts[0]?.value, '-o "my file"');
});

test("the suggested name appends the argument line to the shortcut's name", async () => {
  const { prompts } = answers("--lang fr", "Run FR");
  const { s, calls } = store();
  await duplicateWithArgs(s, file({ label: "Run" }));
  assert.equal(prompts[1]?.value, "Run --lang fr");
  assert.deepEqual(calls, [{ name: "Run FR", args: ["--lang", "fr"] }]);
  assert.equal(info[0], "Added Run FR.");
});

test("the file name is the base when there is no label, and empty args add no suffix", async () => {
  const { prompts } = answers("   ", "plain");
  const { s, calls } = store();
  await duplicateWithArgs(s, file());
  assert.equal(prompts[1]?.value, "run.py");
  assert.deepEqual(calls[0].args, []);
});

test("an existing argument suffix is replaced, not stacked", async () => {
  const { prompts } = answers("-v", "x");
  await duplicateWithArgs(store().s, file({ label: "Run -o out", exec: { args: ["-o", "out"] } }));
  assert.equal(prompts[1]?.value, "Run -v");
});

test("quoted arguments with spaces survive parsing", async () => {
  answers('--name "John Smith" -x', "n");
  const { s, calls } = store();
  await duplicateWithArgs(s, file());
  assert.deepEqual(calls[0].args, ["--name", "John Smith", "-x"]);
});

test("the name prompt rejects a blank name", async () => {
  const { prompts } = answers("", "ok");
  await duplicateWithArgs(store().s, file());
  const validate = prompts[1]?.validateInput!;
  assert.match(validate("   ")!, /Enter a name/);
  assert.equal(validate("fine"), undefined);
});

test("cancelling either prompt creates nothing", async () => {
  const first = answers(undefined, "n");
  const a = store();
  await duplicateWithArgs(a.s, file());
  const second = answers("-x", undefined);
  const b = store();
  await duplicateWithArgs(b.s, file());
  assert.equal(first.prompts.length, 1);
  assert.equal(second.prompts.length, 2);
  assert.deepEqual([a.calls.length, b.calls.length], [0, 0]);
  assert.deepEqual(info.concat(warn), []);
});

test("the chosen name is trimmed in the confirmation, and a failed duplicate warns", async () => {
  answers("", "  Spaced  ");
  await duplicateWithArgs(store().s, file());
  assert.equal(info[0], "Added Spaced.");
  answers("", "Name");
  await duplicateWithArgs(store(false).s, file({ label: "Original" }));
  assert.match(warn[0], /Could not duplicate Original/);
});

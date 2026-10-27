// Unit tests for "suggest shortcuts from shell history": history parsing (bash and
// zsh formats), filtering of trivial commands, frequency threshold and ordering,
// and adding the picked commands. HOME points at a temp folder with fake history.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { __setPickHandler, __resetHandlers } from "./_stub/vscode";
import { suggestFromHistory } from "../commands/ghostShortcuts";
import type { ShortcutStore } from "../model/shortcutStore";

const win = vscode.window as unknown as Record<string, unknown>;
const origHome = process.env.HOME;
const origUserProfile = process.env.USERPROFILE;
const origAppData = process.env.APPDATA;
let home: string;
let info: string[];
let origInfo: unknown;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.APPDATA;
  info = [];
  origInfo = win.showInformationMessage;
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserProfile;
  if (origAppData !== undefined) {
    process.env.APPDATA = origAppData;
  }
  win.showInformationMessage = origInfo;
  __resetHandlers();
  fs.rmSync(home, { recursive: true, force: true });
});

function store() {
  const added: Array<{ label: string; command: string; scope: string; terminal: boolean }> = [];
  const s = {
    addShellShortcut: async (label: string, command: string, scope: string, terminal: boolean) => {
      added.push({ label, command, scope, terminal });
      return true;
    },
  } as unknown as ShortcutStore;
  return { s, added };
}

const lines = (cmd: string, n: number): string => Array.from({ length: n }, () => cmd).join("\n") + "\n";

test("with no history at all it says nothing was found", async () => {
  const { s, added } = store();
  await suggestFromHistory(s);
  assert.equal(
    info[0],
    "No commands found that you have typed at least 3 times. The scan reads your local shell history only and is never transmitted."
  );
  assert.deepEqual(added, []);
});

test("commands run fewer than three times are not suggested", async () => {
  fs.writeFileSync(path.join(home, ".bash_history"), lines("npm run build --watch", 2));
  const { s } = store();
  await suggestFromHistory(s);
  assert.equal(info.length, 1);
});

test("trivial, short and single-word commands are never suggested", async () => {
  fs.writeFileSync(
    path.join(home, ".bash_history"),
    lines("ls -la /some/long/path", 5) + lines("cd /some/long/directory", 5) + lines("make", 5) + lines("git st", 5)
  );
  const { s } = store();
  await suggestFromHistory(s);
  assert.equal(info.length, 1, "nothing worth suggesting, so only the 'none' message");
});

test("bash and zsh histories are merged, zsh timestamps stripped, and ranked by count", async () => {
  fs.writeFileSync(path.join(home, ".bash_history"), lines("npm run build --watch", 2) + lines("docker compose up -d", 3));
  fs.writeFileSync(
    path.join(home, ".zsh_history"),
    [": 1700000000:0;npm run build --watch", ": 1700000001:0;npm run build --watch", ""].join("\n")
  );
  let offered: Array<{ label: string; description: string }> = [];
  __setPickHandler(async (items) => ((offered = items as typeof offered), undefined));
  const { s } = store();
  await suggestFromHistory(s);
  assert.deepEqual(offered.map((o) => o.label), ["npm run build --watch", "docker compose up -d"]);
  assert.deepEqual(offered.map((o) => o.description), ["typed 4 times", "typed 3 times"]);
});

test("picked commands become global terminal shortcuts, with long labels shortened", async () => {
  const long = "kubectl rollout restart deployment/" + "x".repeat(60);
  fs.writeFileSync(path.join(home, ".bash_history"), lines(long, 3) + lines("git fetch --all --prune", 3));
  __setPickHandler(async (items) => items);
  const { s, added } = store();
  await suggestFromHistory(s);
  assert.equal(added.length, 2);
  const longOne = added.find((a) => a.command === long)!;
  assert.equal(longOne.label.length, 50);
  assert.ok(longOne.label.endsWith("…"));
  assert.ok(added.every((a) => a.scope === "global" && a.terminal === true));
  assert.equal(
    info[info.length - 1],
    "Saved 2 command(s) as global shell shortcuts. They never run on their own — double-click to run."
  );
});

test("cancelling the picker adds nothing", async () => {
  fs.writeFileSync(path.join(home, ".bash_history"), lines("git fetch --all --prune", 3));
  __setPickHandler(async () => undefined);
  const { s, added } = store();
  await suggestFromHistory(s);
  assert.deepEqual(added, []);
  assert.equal(info.length, 0);
});

test("blank and CRLF lines are tolerated", async () => {
  fs.writeFileSync(path.join(home, ".bash_history"), "\r\n\r\ngit fetch --all --prune\r\ngit fetch --all --prune\r\ngit fetch --all --prune\r\n");
  let offered: unknown[] = [];
  __setPickHandler(async (items) => ((offered = [...items]), undefined));
  await suggestFromHistory(store().s);
  assert.equal(offered.length, 1);
});

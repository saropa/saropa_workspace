// Unit tests for the optional sound cue: the enable/override matrix and the
// per-event command choice. child_process.spawn is replaced so nothing plays.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { playCue } from "../exec/soundCue";

type StubVscode = typeof vscode & {
  __setConfig(section: string, key: string, value: unknown): void;
  __resetConfig(): void;
};
const stub = vscode as StubVscode;
// A namespace import is read-only under the bundler; patch the live module object.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cpBag = require("node:child_process") as Record<string, unknown>;
const origSpawn = cpBag.spawn;
const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

interface Spawned {
  cmd: string;
  args: string[];
}
let spawned: Spawned[];
let failFirst = false;

function setPlatform(p: string): void {
  Object.defineProperty(process, "platform", { value: p });
}

beforeEach(() => {
  stub.__resetConfig();
  spawned = [];
  failFirst = false;
  cpBag.spawn = (cmd: string, args: string[]): unknown => {
    spawned.push({ cmd, args });
    const first = spawned.length === 1;
    return {
      on(event: string, cb: () => void): void {
        if (event === "error" && failFirst && first) {
          cb();
        }
      },
      unref(): void {},
    };
  };
});

afterEach(() => {
  cpBag.spawn = origSpawn;
  Object.defineProperty(process, "platform", origPlatform);
});

function enable(extra: Record<string, boolean> = {}): void {
  stub.__setConfig("saropaWorkspace.sound", "enabled", true);
  for (const [k, v] of Object.entries(extra)) {
    stub.__setConfig("saropaWorkspace.sound", k, v);
  }
}

test("nothing plays while the master switch is off", () => {
  playCue("success");
  assert.equal(spawned.length, 0);
});

test("a per-shortcut off override silences even an enabled setting", () => {
  enable();
  playCue("success", "off");
  assert.equal(spawned.length, 0);
});

test("a per-shortcut on override still needs the master switch", () => {
  playCue("start", "on");
  assert.equal(spawned.length, 0);
  enable();
  playCue("start", "on");
  assert.equal(spawned.length, 1);
});

test("defaults: success and failure play, start does not", () => {
  enable();
  playCue("start");
  assert.equal(spawned.length, 0);
  playCue("success");
  playCue("failure");
  assert.equal(spawned.length, 2);
});

test("per-event settings can be switched either way", () => {
  enable({ onStart: true, onSuccess: false, onFailure: false });
  playCue("start");
  playCue("success");
  playCue("failure");
  assert.equal(spawned.length, 1);
});

test("linux uses canberra with a sound id per event", () => {
  setPlatform("linux");
  enable({ onStart: true });
  playCue("success");
  playCue("failure");
  playCue("start");
  assert.deepEqual(spawned.map((s) => [s.cmd, s.args[1]]), [
    ["canberra-gtk-play", "complete"],
    ["canberra-gtk-play", "dialog-error"],
    ["canberra-gtk-play", "bell"],
  ]);
});

test("linux falls back to paplay when canberra cannot start", () => {
  setPlatform("linux");
  enable();
  failFirst = true;
  playCue("failure");
  assert.equal(spawned.length, 2);
  assert.equal(spawned[1].cmd, "paplay");
  assert.match(spawned[1].args[0], /dialog-error\.oga$/);
});

test("macOS plays a system sound file per event", () => {
  setPlatform("darwin");
  enable();
  playCue("success");
  playCue("failure");
  assert.deepEqual(spawned.map((s) => [s.cmd, s.args[0]]), [
    ["afplay", "/System/Library/Sounds/Glass.aiff"],
    ["afplay", "/System/Library/Sounds/Basso.aiff"],
  ]);
});

test("Windows plays a SystemSounds entry through PowerShell", () => {
  setPlatform("win32");
  enable({ onStart: true });
  playCue("success");
  playCue("failure");
  playCue("start");
  assert.deepEqual(spawned.map((s) => s.args[3]), [
    "[System.Media.SystemSounds]::Asterisk.Play()",
    "[System.Media.SystemSounds]::Hand.Play()",
    "[System.Media.SystemSounds]::Beep.Play()",
  ]);
  assert.ok(spawned.every((s) => s.cmd === "powershell.exe"));
});

test("an unsupported platform plays nothing", () => {
  setPlatform("freebsd");
  enable();
  playCue("success");
  assert.equal(spawned.length, 0);
});

test("a spawn that throws is contained", () => {
  setPlatform("darwin");
  enable();
  cpBag.spawn = (): never => {
    throw new Error("no such binary");
  };
  assert.doesNotThrow(() => playCue("success"));
});

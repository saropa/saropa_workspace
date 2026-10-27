// Tests for the external-window launcher: the command line each platform spawns, elevation, the
// fire-and-forget outcomes and the error reporting. child_process is replaced with a recorder so no
// window is ever opened.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  __setConfig, __resetConfig, __infoMessages, __resetInfo, __warningMessages, __resetWarnings, __errorMessages,
} from "./_stub/vscode";
import { runInExternal } from "../exec/externalLauncher";
import { getOutputChannel } from "../exec/terminalRunner";
import { encodeForPowerShell, buildWindowsStartup } from "../exec/commandPlan";
import { l10n } from "../i18n/l10n";
import type { FakeOutputChannel } from "./_stub/vscodeOutput";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require("node:child_process") as typeof import("node:child_process");

interface Spawn {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}
interface FakeChild extends EventEmitter {
  stderr: PassThrough | null;
  unrefCalls: number;
  unref(): void;
}

const realSpawn = cp.spawn;
const realSpawnSync = cp.spawnSync;
const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
let spawns: Spawn[] = [];
let children: FakeChild[] = [];
let available: Set<string>;
let throwOnSpawn: Error | undefined;

// Lets the piped stderr data events reach their listeners before the exit is emitted.
const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const channel = (): FakeOutputChannel => getOutputChannel() as unknown as FakeOutputChannel;
const setPlatform = (platform: string): void => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
};

beforeEach(() => {
  spawns = [];
  children = [];
  available = new Set();
  throwOnSpawn = undefined;
  (cp as unknown as Record<string, unknown>).spawn = (command: string, args: string[], options: Record<string, unknown>): FakeChild => {
    if (throwOnSpawn) {
      throw throwOnSpawn;
    }
    spawns.push({ command, args, options });
    const stdio = options.stdio as unknown[] | string;
    const piped = Array.isArray(stdio) && stdio[2] === "pipe";
    const child = Object.assign(new EventEmitter(), {
      stderr: piped ? new PassThrough() : null,
      unrefCalls: 0,
      unref(): void {
        child.unrefCalls++;
      },
    }) as FakeChild;
    children.push(child);
    return child;
  };
  (cp as unknown as Record<string, unknown>).spawnSync = (_cmd: string, args: string[]): { status: number } => ({ status: available.has(args[0]) ? 0 : 1 });
  channel().clear();
  __resetConfig();
});

afterEach(() => {
  (cp as unknown as Record<string, unknown>).spawn = realSpawn;
  (cp as unknown as Record<string, unknown>).spawnSync = realSpawnSync;
  Object.defineProperty(process, "platform", realPlatform);
  __resetInfo();
  __resetWarnings();
  __resetConfig();
});

test("on Linux the first available emulator opens a window that runs the command then keeps a shell", async () => {
  setPlatform("linux");
  available = new Set(["gnome-terminal", "xterm"]);
  await runInExternal("npm test", "/work dir", undefined, false, "Tests");
  assert.equal(spawns.length, 1);
  const [spawn] = spawns;
  assert.equal(spawn.command, "gnome-terminal");
  assert.deepEqual(spawn.args.slice(0, 3), ["--", "bash", "-c"]);
  assert.equal(spawn.args[3], `cd "/work dir"; npm test; exec ${process.env.SHELL ?? "bash"}`);
  assert.deepEqual(spawn.options, { cwd: "/work dir", detached: true, stdio: "ignore" });
  assert.equal(children[0].unrefCalls, 1);
});

test("on Linux each emulator keeps its own argument style, in preference order", async () => {
  setPlatform("linux");
  for (const [emulator, prefix] of [["x-terminal-emulator", ["-e", "bash", "-c"]], ["konsole", ["-e", "bash", "-c"]], ["xterm", ["-e", "bash", "-c"]]] as const) {
    spawns = [];
    available = new Set([emulator]);
    await runInExternal("ls", "/w", undefined, false, "n");
    assert.equal(spawns[0].command, emulator);
    assert.deepEqual(spawns[0].args.slice(0, 3), prefix);
  }
});

test("on Linux elevation puts pkexec in front of the command", async () => {
  setPlatform("linux");
  available = new Set(["xterm"]);
  await runInExternal("apt update", "/w", undefined, true, "Update");
  assert.equal(spawns[0].args[3], `cd /w; pkexec apt update; exec ${process.env.SHELL ?? "bash"}`);
});

test("on Linux with no emulator installed the failure is logged and shown, and nothing is started", async () => {
  setPlatform("linux");
  const before = __errorMessages().length;
  await runInExternal("ls", "/w", undefined, false, "List");
  assert.deepEqual(spawns, []);
  assert.deepEqual(__errorMessages().slice(before), [l10n("run.externalFailed", { name: "List", error: "No supported terminal emulator found" })]);
  assert.deepEqual(channel().lines.at(-1), "\n[List] failed to launch external window: No supported terminal emulator found");
  assert.deepEqual(__infoMessages(), []);
});

test("the run is logged first with its location, elevation and command", async () => {
  setPlatform("linux");
  available = new Set(["xterm"]);
  await runInExternal("ls", "/w", undefined, true, "List");
  assert.equal(channel().lines[0], "$ (List) [external, elevated] ls");
});

test("on macOS Terminal is driven through osascript with the command escaped, sudo when elevated", async () => {
  setPlatform("darwin");
  await runInExternal('echo "hi" \\ there', "/work dir", undefined, false, "Say");
  assert.equal(spawns[0].command, "osascript");
  assert.deepEqual(spawns[0].args, ["-e", 'tell application "Terminal" to do script "cd \\"/work dir\\"; echo \\"hi\\" \\\\ there"']);
  assert.deepEqual(spawns[0].options, { detached: true, stdio: "ignore" });
  spawns = [];
  await runInExternal("make", "/w", undefined, true, "Make");
  assert.equal(spawns[0].args[1], 'tell application "Terminal" to do script "cd /w; sudo make"');
});

test("on Windows a PowerShell window is requested through Start-Process with the startup script encoded", async () => {
  setPlatform("win32");
  await runInExternal("npm test", "C:\\work", { FOO: "1" }, false, "Tests");
  const [spawn] = spawns;
  const encoded = encodeForPowerShell(buildWindowsStartup("npm test", "C:\\work"));
  assert.equal(spawn.command, "powershell.exe");
  assert.deepEqual(spawn.args, [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit','-NoProfile','-EncodedCommand','${encoded}'`,
  ]);
  assert.equal(spawn.options.detached, false);
  assert.equal(spawn.options.windowsHide, true);
  assert.deepEqual(spawn.options.stdio, ["ignore", "ignore", "pipe"]);
  assert.equal((spawn.options.env as Record<string, string>).FOO, "1");
  assert.equal(channel().lines[0], "$ (Tests) [external, powershell.exe] npm test");
});

test("on Windows elevation adds RunAs, leaves the wrapper window visible and warns that variables are dropped", async () => {
  setPlatform("win32");
  await runInExternal("setup", "C:\\w", { TOKEN: "x" }, true, "Setup");
  assert.match(spawns[0].args[2], / -Verb RunAs$/);
  assert.equal(spawns[0].options.windowsHide, false);
  assert.deepEqual(__warningMessages(), [l10n("run.elevatedEnvDropped", { name: "Setup" })]);
  assert.deepEqual(__infoMessages(), [l10n("run.externalElevatedStarted", { name: "Setup" })]);
});

test("elevation with no variables to drop shows no warning", async () => {
  setPlatform("win32");
  await runInExternal("setup", "C:\\w", {}, true, "Setup");
  await runInExternal("setup", "C:\\w", undefined, true, "Setup");
  assert.deepEqual(__warningMessages(), []);
});

test("a clean wrapper exit is logged as a requested window; a failing one shows its error text", async () => {
  setPlatform("win32");
  await runInExternal("a", "C:\\w", undefined, false, "Ok");
  children[0].emit("exit", 0);
  assert.equal(channel().lines.at(-1), "[Ok] external launcher: window requested successfully");
  await runInExternal("b", "C:\\w", undefined, false, "Bad");
  children[1].stderr!.write("Access is denied\n");
  await drain();
  const before = __errorMessages().length;
  children[1].emit("exit", 1);
  assert.equal(channel().lines.at(-1), "[Bad] external launcher failed: Access is denied");
  assert.deepEqual(__errorMessages().slice(before), [l10n("run.externalFailed", { name: "Bad", error: "Access is denied" })]);
});

test("a failing wrapper with no error text reports its exit code", async () => {
  setPlatform("win32");
  await runInExternal("b", "C:\\w", undefined, false, "Bad");
  children[0].emit("exit", 7);
  assert.equal(channel().lines.at(-1), "[Bad] external launcher failed: exit code 7");
});

test("wrapper error text is cut at 4096 characters", async () => {
  setPlatform("win32");
  await runInExternal("b", "C:\\w", undefined, false, "Bad");
  children[0].stderr!.write("x".repeat(5000));
  await drain();
  children[0].emit("exit", 1);
  assert.equal(channel().lines.at(-1), `[Bad] external launcher failed: ${"x".repeat(4096)}`);
});

test("an exit without a code (killed by a signal) counts as a clean request", async () => {
  setPlatform("win32");
  await runInExternal("b", "C:\\w", undefined, false, "Sig");
  children[0].emit("exit", null);
  assert.equal(channel().lines.at(-1), "[Sig] external launcher: window requested successfully");
});

test("an asynchronous spawn error is logged and shown", async () => {
  setPlatform("linux");
  available = new Set(["xterm"]);
  await runInExternal("ls", "/w", undefined, false, "List");
  const before = __errorMessages().length;
  children[0].emit("error", new Error("spawn xterm ENOENT"));
  assert.equal(channel().lines.at(-1), "[List] external launcher spawn error: spawn xterm ENOENT");
  assert.deepEqual(__errorMessages().slice(before), [l10n("run.externalFailed", { name: "List", error: "spawn xterm ENOENT" })]);
});

test("a spawn that throws is reported and no started message is shown", async () => {
  setPlatform("darwin");
  throwOnSpawn = new Error("boom");
  const before = __errorMessages().length;
  await runInExternal("ls", "/w", undefined, false, "List");
  assert.deepEqual(__errorMessages().slice(before), [l10n("run.externalFailed", { name: "List", error: "boom" })]);
  assert.deepEqual(__infoMessages(), []);
});

test("a started message is shown unless run toasts are turned off", async () => {
  setPlatform("linux");
  available = new Set(["xterm"]);
  await runInExternal("ls", "/w", undefined, false, "List");
  assert.deepEqual(__infoMessages(), [l10n("run.externalStarted", { name: "List" })]);
  __resetInfo();
  __setConfig("saropaWorkspace", "showRunToasts", false);
  await runInExternal("ls", "/w", undefined, false, "List");
  assert.deepEqual(__infoMessages(), []);
});

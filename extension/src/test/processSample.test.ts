// Tests for the process sampler: name normalization, the real `ps` sample on this
// machine, and the Windows and `ps` output parsers fed with canned command output.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, sampleOnce } from "../exec/processSample";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp = require("node:child_process") as { execFile: unknown };
const realExecFile = cp.execFile;
const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

type Callback = (err: Error | null, stdout: string) => void;
let seen: { file: string; args: string[] } | undefined;

function fakeExec(stdout: string, err: Error | null = null): void {
  cp.execFile = (file: string, args: string[], _opts: unknown, cb: Callback): void => {
    seen = { file, args };
    cb(err, stdout);
  };
}

beforeEach(() => {
  seen = undefined;
});
afterEach(() => {
  cp.execFile = realExecFile;
  Object.defineProperty(process, "platform", realPlatform);
});

test("names lose their directory, a Windows .exe suffix and their case", () => {
  assert.equal(normalizeName("/usr/bin/Node"), "node");
  assert.equal(normalizeName("C:\\Program Files\\Code\\Code.EXE"), "code");
  assert.equal(normalizeName("plain"), "plain");
  assert.equal(normalizeName("archive.exe.bak"), "archive.exe.bak");
});

test("the real sample on this machine includes this process with its parent", { skip: process.platform === "win32" }, async () => {
  const sample = await sampleOnce();
  const me = sample.get(process.pid);
  assert.ok(me, "this process is listed");
  assert.equal(me.ppid, process.ppid);
  assert.ok(me.rssBytes > 0);
  assert.ok(me.name.length > 0);
});

test("ps output is parsed into pid, parent, memory in bytes, cpu time and name", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  fakeExec(
    [
      "    1     0  2048 00:00:05 /sbin/init",
      "  200     1   512 01:02:03 /usr/bin/my tool",
      " 300   200  1024 2-00:00:10 node",
      "garbage line",
      "",
    ].join("\n")
  );
  const sample = await sampleOnce();
  assert.equal(seen?.file, "ps");
  assert.deepEqual(seen?.args, ["-axo", "pid=,ppid=,rss=,time=,comm="]);
  assert.deepEqual([...sample.keys()], [1, 200, 300]);
  assert.deepEqual(sample.get(1), { pid: 1, ppid: 0, name: "/sbin/init", rssBytes: 2048 * 1024, cpuMs: 5000 });
  assert.deepEqual(sample.get(200), { pid: 200, ppid: 1, name: "/usr/bin/my tool", rssBytes: 512 * 1024, cpuMs: (3600 + 120 + 3) * 1000 });
  assert.equal(sample.get(300)?.cpuMs, (2 * 86400 + 10) * 1000);
});

test("a short cpu time of just minutes and seconds is read right", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  fakeExec(" 10 1 100 12:30 x");
  assert.equal((await sampleOnce()).get(10)?.cpuMs, (12 * 60 + 30) * 1000);
});

test("a failing ps or empty output gives an empty sample", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  fakeExec("", null);
  assert.equal((await sampleOnce()).size, 0);
  fakeExec("data", new Error("ps missing"));
  assert.equal((await sampleOnce()).size, 0);
});

test("Windows output is parsed from the PowerShell JSON, with times converted from 100ns ticks", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  fakeExec(
    JSON.stringify([
      { ProcessId: 4, ParentProcessId: 0, Name: "System", WorkingSetSize: 1000, KernelModeTime: 20000, UserModeTime: 10000 },
      { ProcessId: 8, Name: "node.exe" },
      { Name: "no pid" },
    ])
  );
  const sample = await sampleOnce();
  assert.equal(seen?.file, "powershell.exe");
  assert.deepEqual([...sample.keys()], [4, 8]);
  assert.deepEqual(sample.get(4), { pid: 4, ppid: 0, name: "System", rssBytes: 1000, cpuMs: 3 });
  assert.deepEqual(sample.get(8), { pid: 8, ppid: 0, name: "node.exe", rssBytes: 0, cpuMs: 0 });
});

test("a single Windows process comes back as an object rather than a list and is still read", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  fakeExec(JSON.stringify({ ProcessId: 5, Name: "only" }));
  assert.deepEqual([...(await sampleOnce()).keys()], [5]);
});

test("unparseable Windows output gives an empty sample", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  fakeExec("not json");
  assert.equal((await sampleOnce()).size, 0);
});

test("ps output with fractional CPU seconds (macOS) is parsed", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  fakeExec("  334     1  6944  39:40.72 /usr/libexec/logd\n");
  const sample = await sampleOnce();
  assert.equal(sample.get(334)?.cpuMs, (39 * 60 + 40.72) * 1000);
});

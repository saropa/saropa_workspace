// Tests for the Processes tab host side: the poll message sequence, copying the report, and the
// confirm-gated end of a single process.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as vscode from "./_stub/vscode";
import {
  __infoMessages, __resetInfo, __warningMessages, __setWarningAnswer, __resetWarnings, __errorMessages, __resetEnv,
} from "./_stub/vscode";
import { fakeWebviewPanel } from "./_stub/vscodeWebview";
import { pollProcessesTab, copyProcessReport, killProcessTab } from "../views/dashboardProcessesTab";
import { buildProcessReportMarkdown, type PollResult } from "../exec/processPoll";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
const children: ChildProcess[] = [];

const result: PollResult = {
  cores: 4,
  totalRamBytes: 8 * 1024 ** 3,
  freeRamBytes: 4 * 1024 ** 3,
  groups: [{ tool: "Node toolchain", icon: "server-process", cpuPercent: 12.5, rssBytes: 1024 ** 2, pidCount: 1, procs: [{ pid: 7, ppid: 1, name: "node", rssBytes: 1024 ** 2, cpuPercent: 12.5 }] }],
  sampledAt: 1_700_000_000_000,
};

function sleeper(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(child);
  return child;
}

beforeEach(() => {
  fx = createFsFixture("sw-procstab-");
});

afterEach(() => {
  fx.remove();
  __resetInfo();
  __resetWarnings();
  __resetEnv();
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
});

test("a poll announces sampling, then sends the groups, the trend and which groups can be ended", async () => {
  const panel = fakeWebviewPanel("t", "t");
  const polled = await pollProcessesTab(panel.webview as never);
  const [first, second] = panel.webview.postedMessages as Array<Record<string, unknown>>;
  assert.deepEqual(first, { type: "sampling" });
  assert.equal(second.type, "data");
  assert.equal(second.result, polled);
  assert.deepEqual(second.trend, []);
  const groups = (polled.groups as Array<{ tool: string }>).map((g) => g.tool);
  assert.deepEqual(Object.keys(second.killable as object), groups);
  assert.equal((second.killable as Record<string, boolean>)["Docker"] ?? false, false);
});

test("copying puts the Markdown report on the clipboard and says so", async () => {
  await copyProcessReport(result);
  assert.equal(await vscode.env.clipboard.readText(), buildProcessReportMarkdown(result));
  assert.deepEqual(__infoMessages(), [l10n("monitor.copied")]);
});

test("copying before any poll does nothing", async () => {
  await copyProcessReport(undefined);
  assert.equal(await vscode.env.clipboard.readText(), "");
  assert.deepEqual(__infoMessages(), []);
});

test("ending needs a numeric pid, a name and a tool", async () => {
  let refreshed = 0;
  const onKilled = async (): Promise<void> => {
    refreshed++;
  };
  await killProcessTab(undefined, "node", "Node toolchain", onKilled);
  await killProcessTab(5, "", "Node toolchain", onKilled);
  await killProcessTab(5, "node", undefined, onKilled);
  assert.deepEqual([refreshed, __warningMessages()], [0, []]);
});

test("a protected group (a container runtime) is refused without asking", async () => {
  let refreshed = 0;
  await killProcessTab(5, "dockerd", "Docker", async () => {
    refreshed++;
  });
  assert.deepEqual(__warningMessages(), [l10n("monitor.kill.protected", { tool: "Docker" })]);
  assert.equal(refreshed, 0);
});

test("an unknown tool group is refused as protected", async () => {
  await killProcessTab(5, "x", "Mystery", async () => {});
  assert.deepEqual(__warningMessages(), [l10n("monitor.kill.protected", { tool: "Mystery" })]);
});

test("declining the confirm keeps the process running and does not refresh", async () => {
  const child = sleeper();
  let refreshed = 0;
  await killProcessTab(child.pid!, "node", "Node toolchain", async () => {
    refreshed++;
  });
  assert.deepEqual(__warningMessages(), [l10n("monitor.kill.confirm", { name: "node", pid: child.pid! })]);
  assert.equal(refreshed, 0);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.doesNotThrow(() => process.kill(child.pid!, 0));
});

test("confirming ends exactly that process, says so and refreshes the list", async () => {
  const child = sleeper();
  const exited = new Promise<string | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
  __setWarningAnswer(() => l10n("monitor.kill.confirmAction"));
  let refreshed = 0;
  await killProcessTab(child.pid!, "node", "Node toolchain", async () => {
    refreshed++;
  });
  assert.equal(await exited, "SIGTERM");
  assert.deepEqual(__infoMessages(), [l10n("monitor.kill.done", { name: "node", pid: child.pid! })]);
  assert.equal(refreshed, 1);
});

test("ending a process that is already gone reports the failure and still refreshes", async () => {
  const child = sleeper();
  const pid = child.pid!;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
  __setWarningAnswer(() => l10n("monitor.kill.confirmAction"));
  const before = __errorMessages().length;
  let refreshed = 0;
  await killProcessTab(pid, "node", "Node toolchain", async () => {
    refreshed++;
  });
  assert.equal(__errorMessages().length, before + 1);
  assert.match(__errorMessages()[before], /^Could not end node \(PID \d+\): kill ESRCH$/);
  assert.equal(refreshed, 1);
});

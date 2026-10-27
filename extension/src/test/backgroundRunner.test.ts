// Unit tests for the background runner. Real child processes (node) are spawned, so
// exit codes, captured output, the run registry and the completion event are
// exercised end to end; only the editor toasts are faked.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as vscode from "vscode";
import { runInBackground } from "../exec/backgroundRunner";
import { runStatusRegistry } from "../exec/runStatus";
import { runOutputs } from "../exec/runOutputs";
import { processRegistry } from "../exec/processRegistry";
import { shortcutBadges } from "../exec/shortcutBadges";
import { shortcutEvents } from "../exec/shortcutEvents";
import * as runLock from "../exec/runLock";

const win = vscode.window as unknown as Record<string, unknown>;
let info: string[];
let errors: Array<{ message: string; actions: string[] }>;
const saved: Record<string, unknown> = {};
let n = 0;

beforeEach(() => {
  info = [];
  errors = [];
  saved.info = win.showInformationMessage;
  saved.error = win.showErrorMessage;
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showErrorMessage = (m: string, ...actions: string[]): Promise<undefined> => (
    errors.push({ message: m, actions }),
    Promise.resolve(undefined)
  );
});

afterEach(() => {
  win.showInformationMessage = saved.info;
  win.showErrorMessage = saved.error;
});

const id = (): string => `bg-${process.pid}-${++n}`;
const cwd = os.tmpdir();

// Poll until the run has been recorded (the process exits asynchronously).
async function finished(pinId: string): Promise<NonNullable<ReturnType<typeof runStatusRegistry.get>>> {
  for (let i = 0; i < 200; i++) {
    const r = runStatusRegistry.get(pinId);
    if (r) {
      return r;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("run did not finish");
}

const nodeCmd = (code: string): string => `node -e "${code}"`;

test("a successful run records success, exit 0, its output, and says it finished", async () => {
  const pinId = id();
  await runInBackground(nodeCmd("console.log('hello-bg')"), cwd, undefined, "Say hi", pinId);
  const result = await finished(pinId);
  assert.equal(result.outcome, "success");
  assert.equal(result.exitCode, 0);
  assert.ok(result.durationMs >= 0);
  assert.match(runOutputs.latest(pinId)!.output, /hello-bg/);
  assert.equal(runOutputs.latest(pinId)!.exitCode, 0);
  assert.match(info[0], /^Say hi finished in /);
  assert.deepEqual(errors, []);
});

test("a failing run records failure with its exit code and raises an error toast", async () => {
  const pinId = id();
  await runInBackground(nodeCmd("process.exit(3)"), cwd, undefined, "Broken", pinId);
  const result = await finished(pinId);
  assert.equal(result.outcome, "failure");
  assert.equal(result.exitCode, 3);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /^Broken failed \(exit 3\) after /);
  assert.deepEqual(errors[0].actions, ["Show Output"]);
});

test("stderr is captured along with stdout", async () => {
  const pinId = id();
  await runInBackground(nodeCmd("console.error('oops-err'); console.log('plain-out')"), cwd, undefined, "Both", pinId);
  await finished(pinId);
  const out = runOutputs.latest(pinId)!.output;
  assert.match(out, /oops-err/);
  assert.match(out, /plain-out/);
});

test("extra environment variables reach the process and the working directory is used", async () => {
  const pinId = id();
  await runInBackground(
    nodeCmd("console.log(process.env.BG_TEST_VALUE + '@' + process.cwd())"),
    cwd,
    { BG_TEST_VALUE: "from-env" },
    "Env",
    pinId
  );
  await finished(pinId);
  const out = runOutputs.latest(pinId)!.output;
  assert.match(out, /from-env@/);
  assert.ok(out.includes(require("node:fs").realpathSync(cwd)));
});

test("a failure whose output suggests a fix command offers to run it", async () => {
  const pinId = id();
  await runInBackground(
    // Backticks are built in JS: a literal one would be a command substitution in the shell.
    nodeCmd("const q = String.fromCharCode(96); console.error('missing module, try running ' + q + 'npm install left-pad' + q); process.exit(1)"),
    cwd,
    undefined,
    "Needs dep",
    pinId
  );
  await finished(pinId);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(errors[0].actions, ["Run: npm install left-pad", "Show Output"]);
});

test("a run is registered as running while alive and cleared afterwards", async () => {
  const pinId = id();
  await runInBackground(nodeCmd("setTimeout(()=>{}, 300)"), cwd, undefined, "Slow", pinId);
  assert.equal(processRegistry.isRunning(pinId), true);
  await finished(pinId);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(processRegistry.isRunning(pinId), false);
});

test("a held lock name is taken for the run and released when it ends", async () => {
  const pinId = id();
  const lock = `lock-${pinId}`;
  await runInBackground(nodeCmd("setTimeout(()=>{}, 300)"), cwd, undefined, "Locked", pinId, undefined, undefined, undefined, lock);
  assert.equal(runLock.isHeld(lock), true);
  await finished(pinId);
  assert.equal(runLock.isHeld(lock), false);
});

test("completion is announced to listeners with the outcome", async () => {
  const pinId = id();
  const seen: Array<{ pinId: string; outcome: string }> = [];
  const sub = shortcutEvents.onDidComplete((e) => seen.push(e));
  await runInBackground(nodeCmd("process.exit(0)"), cwd, undefined, "Evt", pinId);
  await finished(pinId);
  sub.dispose();
  assert.deepEqual(seen.filter((e) => e.pinId === pinId), [{ pinId, outcome: "success" }]);
});

test("lint-style output updates the shortcut's badge", async () => {
  const pinId = id();
  await runInBackground(nodeCmd("console.log('✖ 12 problems (3 errors, 9 warnings)')"), cwd, undefined, "Lint", pinId);
  await finished(pinId);
  const badge = shortcutBadges.get(pinId);
  assert.equal(badge?.errors, 3);
  assert.equal(badge?.warnings, 9);
});

test("output with nothing recognizable leaves no badge", async () => {
  const pinId = id();
  await runInBackground(nodeCmd("console.log('just text')"), cwd, undefined, "Plain", pinId);
  await finished(pinId);
  assert.equal(shortcutBadges.get(pinId), undefined);
});

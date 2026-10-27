// Tests for "Diff Last Two Runs": the virtual document provider and the diff request.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __providerRegistrations,
  __resetHosts,
  __recordedCommands,
  __resetRecordedCommands,
  __infoMessages,
  __resetInfo,
} from "./_stub/vscode";
import { registrarContext } from "./registrarCheck";
import { registerRunOutputDiff, diffLastRuns } from "../commands/diffRuns";
import { runOutputs } from "../exec/runOutputs";
import type { Shortcut } from "../model/shortcut";

interface ContentProvider {
  provideTextDocumentContent(uri: { toString(): string }): string;
}

function shortcut(id: string, label: string): Shortcut {
  return { id, label, path: "/p/x.sh", scope: "project", order: 0 } as Shortcut;
}

beforeEach(() => {
  __resetHosts();
  __resetRecordedCommands();
  __resetInfo();
});

test("registering adds the run-output content provider and keeps both disposables", () => {
  const ctx = registrarContext();
  registerRunOutputDiff(ctx as never);
  assert.deepEqual(__providerRegistrations().map((p) => [p.kind, p.id]), [["textDocumentContent", "saropa-runoutput"]]);
  assert.equal(ctx.subscriptions.length, 2);
  ctx.subscriptions.forEach((d) => d.dispose());
  assert.deepEqual(__providerRegistrations(), []);
});

test("with fewer than two captured runs it says so and opens no diff", async () => {
  runOutputs.record("one-run", { output: "x", endedAt: 1, exitCode: 0 });
  await diffLastRuns(shortcut("one-run", "Build"));
  assert.deepEqual(__infoMessages(), ["Run Build in the background at least twice to compare its output."]);
  assert.deepEqual(__recordedCommands(), []);
});

test("two runs open a diff titled with the name, each side headed by its end time and exit code", async () => {
  const ctx = registrarContext();
  registerRunOutputDiff(ctx as never);
  const provider = __providerRegistrations()[0].provider as ContentProvider;
  runOutputs.record("two-runs", { output: "old line", endedAt: 1000, exitCode: 1 });
  runOutputs.record("two-runs", { output: "new line", endedAt: 2000, exitCode: null });
  await diffLastRuns(shortcut("two-runs", "Test"));
  const [call] = __recordedCommands();
  assert.equal(call.command, "vscode.diff");
  const [left, right, title] = call.args as [{ toString(): string }, { toString(): string }, string];
  assert.equal(title, "Test: previous vs latest run");
  assert.equal(left.toString(), "saropa-runoutput:/two-runs/previous.log");
  assert.equal(right.toString(), "saropa-runoutput:/two-runs/latest.log");
  assert.equal(
    provider.provideTextDocumentContent(left),
    `Run ended ${new Date(1000).toLocaleString()} (exit 1)\n\nold line`
  );
  assert.equal(
    provider.provideTextDocumentContent(right),
    `Run ended ${new Date(2000).toLocaleString()} (exit ?)\n\nnew line`
  );
  ctx.subscriptions.forEach((d) => d.dispose());
});

test("a uri that was never published reads as an empty document", () => {
  const ctx = registrarContext();
  registerRunOutputDiff(ctx as never);
  const provider = __providerRegistrations()[0].provider as ContentProvider;
  assert.equal(provider.provideTextDocumentContent({ toString: () => "saropa-runoutput:/none/latest.log" }), "");
  ctx.subscriptions.forEach((d) => d.dispose());
});

test("re-diffing a shortcut replaces the text under the same uris", async () => {
  const ctx = registrarContext();
  registerRunOutputDiff(ctx as never);
  const provider = __providerRegistrations()[0].provider as ContentProvider;
  runOutputs.record("again", { output: "a", endedAt: 1, exitCode: 0 });
  runOutputs.record("again", { output: "b", endedAt: 2, exitCode: 0 });
  await diffLastRuns(shortcut("again", "R"));
  runOutputs.record("again", { output: "c", endedAt: 3, exitCode: 0 });
  await diffLastRuns(shortcut("again", "R"));
  const calls = __recordedCommands();
  const right = calls[1].args[1] as { toString(): string };
  assert.equal(right.toString(), (calls[0].args[1] as { toString(): string }).toString());
  assert.ok(provider.provideTextDocumentContent(right).endsWith("\n\nc"));
  ctx.subscriptions.forEach((d) => d.dispose());
});

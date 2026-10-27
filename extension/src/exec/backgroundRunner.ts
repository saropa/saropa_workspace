import * as vscode from "vscode";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { SoundOverride } from "../model/shortcut";
import { processRegistry } from "./processRegistry";
import * as runLock from "./runLock";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { runOutputs } from "./runOutputs";
import { playCue } from "./soundCue";
import { shortcutEvents } from "./shortcutEvents";
import { shortcutBadges, parseRunBadge } from "./shortcutBadges";

import { getOutputChannel } from "./terminalRunner";
import { createBoundedCapture } from "./outputCapture";
import { extractAndCopy, notifyFailure, notifyCompletion } from "./backgroundNotify";

// The background run path: spawn a child, stream its combined output to the shared
// channel, settle exactly once on exit, then record the result and surface the
// outcome (success toast / failure toast with Show Output, port-unwedge, or a
// suggested fix command). Split out of runner.ts as the densest run path, tightly
// coupled around the child process and its single settle() closure.

/** Everything the end-of-run bookkeeping needs from the run that just finished. */
interface RunEndContext {
  readonly child: import("child_process").ChildProcess;
  readonly capture: ReturnType<typeof attachOutputCapture>;
  readonly startedAt: number;
  readonly lockName: string | undefined;
  readonly pinId: string;
  readonly name: string;
  readonly cwd: string;
  readonly extractResult: string | undefined;
  readonly retry: (() => void) | undefined;
  readonly soundOverride: SoundOverride | undefined;
}

/**
 * Records a finished background run: releases the lock, stores the result and
 * output, plays the finish cue, fires the chain event, then badges and notifies.
 * A standalone function, not a closure: everything it needs arrives in `ctx`.
 * Called once per run (the caller's `settled` guard enforces that).
 */
function recordRunEnd(
  ctx: RunEndContext,
  outcome: "success" | "failure",
  code: number | null
): void {
  const { child, capture, startedAt, lockName, pinId, name, cwd, extractResult, retry, soundOverride } = ctx;
  const durationMs = Date.now() - startedAt;
  const endedAt = Date.now();
  // Free the cross-process lock now this run has ended (release only clears our
  // own record, so a run that already stole the lock is unaffected).
  if (lockName && child.pid !== undefined) {
    runLock.release(lockName, child.pid);
  }
  runStatusRegistry.record(pinId, {
    outcome,
    exitCode: code,
    durationMs,
    endedAt,
  });
  // Audio finish cue (#64): distinct success/failure tone, honoring the shortcut's
  // override. Paired with the notifyCompletion toast below — the cue is the
  // additive channel, the toast stays the visible feedback.
  playCue(outcome, soundOverride);
  // Real tracked outcome for the chain engine — a shortcut chained "after" this one
  // (with onlyOnSuccess) runs only when this background run actually succeeded.
  shortcutEvents.fireComplete(pinId, outcome);
  // Snapshot once — getCaptured() rebuilds head+marker+tail on each call,
  // so caching avoids a redundant up-to-1MB string allocation.
  const captured = capture.getCaptured();
  // Keep this run's output for the "Diff Last Two Runs" command.
  runOutputs.record(pinId, { output: captured, endedAt, exitCode: code });
  // Badge, extract, and notify: none of this needs the dedupe guard or the
  // registries above, so it is delegated to keep this closure focused on the
  // mutable state (settled, the registries) the header comment defends keeping
  // together.
  handleRunSettled(
    { pinId, name, cwd, captured, extractResult, retry },
    outcome,
    code,
    durationMs
  );
}

/**
 * Runs a command as a tracked background process: streams its output to the shared
 * channel, settles exactly once on exit, then records the result and surfaces the
 * outcome (success toast, or a failure toast with Show Output, port-unwedge and
 * suggested-fix actions). `retry` re-dispatches the run for the port-unwedge path;
 * `lockName` holds a cross-process lock for the run's lifetime.
 */
export async function runInBackground(
  commandLine: string,
  cwd: string,
  env: Record<string, string> | undefined,
  name: string,
  pinId: string,
  extractResult?: string,
  soundOverride?: SoundOverride,
  // Re-dispatch this same run. Used only by the port-unwedge kill+retry path so a
  // freed port can be retried in one click; absent for callers with no retry route.
  retry?: () => void,
  // Cross-process lock name held for this run's lifetime when the shortcut opts in.
  lockName?: string
): Promise<void> {
  const cp = await import("child_process");
  const channel = getOutputChannel();
  channel.appendLine(`$ (${name}) ${commandLine}`);
  channel.show(true);

  const startedAt = Date.now();
  const child = cp.spawn(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env, ...(env ?? {}) },
  });
  // Track the child so the tree can show it running and a Stop action can kill
  // it; the registry clears itself on exit.
  processRegistry.register(pinId, child);
  // Hold the cross-process lock for this run's lifetime (opt-in). Keyed to the
  // child PID so release() only clears OUR record, and a crash leaves a stale
  // (dead-PID) record the next run steals rather than a permanent block.
  if (lockName && child.pid !== undefined) {
    runLock.acquire(lockName, child.pid, name);
  }
  // Accumulate the combined output so the last two runs can be diffed (WOW #20),
  // in addition to streaming it live to the channel. No coupling to the settle()
  // closure below, so this phase is fully extracted.
  const capture = attachOutputCapture(child, channel);

  // Node may emit BOTH "error" (spawn failed) and "close" for the same failed
  // run; settle once so the result is recorded and the toast shown a single time.
  let settled = false;
  const settle = (outcome: "success" | "failure", code: number | null): void => {
    if (settled) {
      return;
    }
    settled = true;
    recordRunEnd(
      { child, capture, startedAt, lockName, pinId, name, cwd, extractResult, retry, soundOverride },
      outcome,
      code
    );
  };

  // On exit, record the result so the tree shows a success/failure badge (7.2)
  // and surface the outcome: a failure is loud (error toast + one-click output),
  // a success is a quiet confirmation. Code 0 is success; any other code, or a
  // null code (killed by signal / stop), is a failure.
  child.on("close", (code) => {
    channel.appendLine(
      `\n[${name}] exited with code ${code} (${formatDuration(
        Date.now() - startedAt
      )})`
    );
    settle(code === 0 ? "success" : "failure", code);
  });

  // A spawn failure (command not found, cwd missing) may not emit "close"; record
  // it so the tree does not sit on a stale "running" forever.
  child.on("error", (err) => {
    channel.appendLine(`\n[${name}] failed to start: ${err.message}`);
    settle("failure", null);
  });
}

// Wire the child's stdout/stderr to the shared channel, accumulating the combined
// text so callers can read it back once the run settles. No dependency on settle()'s
// mutable state (the dedupe guard, the registries), so — unlike the rest of
// runInBackground — this phase is safe to fully extract.
//
// The channel always gets the full, untruncated stream (VS Code's OutputChannel is
// itself bounded and is the "see everything live" surface); only the in-memory
// capture returned here — read back for the completion toast, badge/extract
// parsing, and "Diff Last Two Runs" — is capped, via createBoundedCapture(), so a
// long-running process cannot grow this process's memory without bound.
function attachOutputCapture(
  child: ChildProcessWithoutNullStreams,
  channel: vscode.OutputChannel
): { getCaptured(): string } {
  const capture = createBoundedCapture();
  child.stdout?.on("data", (d) => {
    const text = d.toString();
    capture.append(text);
    channel.append(text);
  });
  child.stderr?.on("data", (d) => {
    const text = d.toString();
    capture.append(text);
    channel.append(text);
  });
  return capture;
}

// The fields the settled tail (badge, extract, notify) reads from a finished run.
// Carried as one object rather than five parameters so handleRunSettled reads like
// the settle() closure it was split from, not an arbitrary function signature.
interface RunSettledContext {
  readonly pinId: string;
  readonly name: string;
  readonly cwd: string;
  readonly captured: string;
  readonly extractResult?: string;
  readonly retry?: () => void;
}

// The safely-separable tail of settle(): badge parsing, extract-and-copy, and the
// success/failure notify dispatch. Split out from settle() because none of it reads
// or writes the closure's mutable state (settled, the registries) — that state stays
// in settle() itself per the header comment above.
function handleRunSettled(
  ctx: RunSettledContext,
  outcome: "success" | "failure",
  code: number | null,
  durationMs: number
): void {
  // Badge the shortcut with any lint severity counts or test tally found in the output
  // (#26, #32) — so the lint sweep / test-trend ritual shows its result on the shortcut
  // itself, not only in the report. No-op when the output is neither.
  const badge = parseRunBadge(ctx.captured);
  if (badge) {
    shortcutBadges.record(ctx.pinId, badge);
  }
  // Pull a configured value (a deploy URL, a generated id) out of the output and
  // copy it to the clipboard. Runs on any completion — a URL printed before a
  // non-zero exit is still worth grabbing.
  if (ctx.extractResult) {
    extractAndCopy(ctx.extractResult, ctx.captured, ctx.name);
  }
  // A success is a quiet confirmation; a failure may carry an actionable cause —
  // a held port (WOW #1) or a tool-suggested fix command (WOW #12) — so the
  // failure path resolves those (async, for the port-holder lookup) before its
  // toast. Routed off settle so the run record above is written synchronously.
  if (outcome === "failure") {
    void notifyFailure(ctx.name, code, durationMs, ctx.captured, ctx.cwd, ctx.retry);
  } else {
    notifyCompletion(ctx.name, outcome, code, durationMs, undefined);
  }
}

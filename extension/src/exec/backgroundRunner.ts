import * as vscode from "vscode";
import { SoundOverride } from "../model/shortcut";
import { processRegistry } from "./processRegistry";
import * as runLock from "./runLock";
import { runStatusRegistry, formatDuration } from "./runStatus";
import { runOutputs } from "./runOutputs";
import { playCue } from "./soundCue";
import { shortcutEvents } from "./shortcutEvents";
import { shortcutBadges, parseRunBadge } from "./shortcutBadges";
import {
  detectBlockedPort,
  findPortHolder,
  killProcess,
  PortHolder,
} from "./portUnwedge";
import { l10n } from "../i18n/l10n";
import { getOutputChannel, runInTerminal } from "./terminalRunner";

// The background run path: spawn a child, stream its combined output to the shared
// channel, settle exactly once on exit, then record the result and surface the
// outcome (success toast / failure toast with Show Output, port-unwedge, or a
// suggested fix command). Split out of runner.ts as the densest run path, tightly
// coupled around the child process and its single settle() closure.

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
  // in addition to streaming it live to the channel.
  let captured = "";
  child.stdout?.on("data", (d) => {
    const text = d.toString();
    captured += text;
    channel.append(text);
  });
  child.stderr?.on("data", (d) => {
    const text = d.toString();
    captured += text;
    channel.append(text);
  });

  // Node may emit BOTH "error" (spawn failed) and "close" for the same failed
  // run; settle once so the result is recorded and the toast shown a single time.
  let settled = false;
  const settle = (outcome: "success" | "failure", code: number | null): void => {
    if (settled) {
      return;
    }
    settled = true;
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
    // Keep this run's output for the "Diff Last Two Runs" command.
    runOutputs.record(pinId, { output: captured, endedAt, exitCode: code });
    // Badge the shortcut with any lint severity counts or test tally found in the output
    // (#26, #32) — so the lint sweep / test-trend ritual shows its result on the shortcut
    // itself, not only in the report. No-op when the output is neither.
    const badge = parseRunBadge(captured);
    if (badge) {
      shortcutBadges.record(pinId, badge);
    }
    // Pull a configured value (a deploy URL, a generated id) out of the output and
    // copy it to the clipboard. Runs on any completion — a URL printed before a
    // non-zero exit is still worth grabbing.
    if (extractResult) {
      extractAndCopy(extractResult, captured, name);
    }
    // A success is a quiet confirmation; a failure may carry an actionable cause —
    // a held port (WOW #1) or a tool-suggested fix command (WOW #12) — so the
    // failure path resolves those (async, for the port-holder lookup) before its
    // toast. Routed off settle so the run record above is written synchronously.
    if (outcome === "failure") {
      void notifyFailure(name, code, durationMs, captured, cwd, retry);
    } else {
      notifyCompletion(name, outcome, code, durationMs, undefined);
    }
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

// Match a shortcut's extract pattern against its background output and copy the result
// to the clipboard with a toast (WOW #16). The first capture group is preferred (so
// `Live at: (https://\S+)` yields just the URL); with no group, the whole match is
// used. The pattern compiles with the "m" flag so `^`/`$` anchor to lines, the
// intuitive choice for pulling one line out of many. An invalid pattern or no match
// is logged to the channel and otherwise ignored — extraction is a convenience, never
// a reason to fail or nag.
function extractAndCopy(pattern: string, output: string, name: string): void {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "m");
  } catch {
    getOutputChannel().appendLine(
      l10n("extract.invalid", { name, pattern })
    );
    return;
  }
  const match = regex.exec(output);
  if (!match) {
    getOutputChannel().appendLine(l10n("extract.noMatch", { name, pattern }));
    return;
  }
  const value = match[1] ?? match[0];
  void vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(l10n("extract.copied", { name, value }));
}

// Resolve and surface a failed background run's actionable cause, then show the
// completion toast. A held port (WOW #1) takes precedence over a suggested fix
// command (WOW #12): freeing the port is the direct unblock, whereas a fix command
// is the fallback. The port-holder lookup is the only async step, which is why this
// path is async while the success path is not.
async function notifyFailure(
  name: string,
  code: number | null,
  durationMs: number,
  captured: string,
  cwd: string,
  retry?: () => void
): Promise<void> {
  const port = detectBlockedPort(captured);
  if (port !== undefined) {
    const holder = await findPortHolder(port);
    notifyPortBlocked(name, port, holder, cwd, retry);
    return;
  }
  const fix = detectFixCommand(captured);
  notifyCompletion(name, "failure", code, durationMs, fix ? { command: fix, cwd } : undefined);
}

// Toast for a run blocked by a held port. When the holder is known, offer the
// kill+retry action (gated behind a modal confirm in confirmKillAndRetry); when it
// could not be identified, name the port and offer to open a terminal pre-filled
// with the inspect command so the user can free it manually. Show Output is always
// available as the diagnostic fallback.
function notifyPortBlocked(
  name: string,
  port: number,
  holder: PortHolder | undefined,
  cwd: string,
  retry?: () => void
): void {
  const showOutput = l10n("run.showOutput");
  if (!holder) {
    const inspect = l10n("portUnwedge.inspectPort");
    void vscode.window
      .showErrorMessage(
        l10n("portUnwedge.blockedUnknown", { name, port }),
        inspect,
        showOutput
      )
      .then((choice) => {
        if (choice === inspect) {
          runInTerminal(inspectPortCommand(port), cwd, undefined);
        } else if (choice === showOutput) {
          getOutputChannel().show(true);
        }
      });
    return;
  }
  const processName = holder.name ?? l10n("portUnwedge.unknownProcess");
  const killAndRetry = l10n("portUnwedge.killAndRetry");
  void vscode.window
    .showErrorMessage(
      l10n("portUnwedge.blocked", { name, port, process: processName, pid: holder.pid }),
      killAndRetry,
      showOutput
    )
    .then((choice) => {
      if (choice === killAndRetry) {
        void confirmKillAndRetry(name, port, holder, processName, retry);
      } else if (choice === showOutput) {
        getOutputChannel().show(true);
      }
    });
}

// Modal confirm naming the exact PID + image before killing — never auto-kill. On
// a confirmed kill that frees the port, re-dispatch the run (when a retry route
// exists); a failed kill leaves everything as-is and says so.
async function confirmKillAndRetry(
  name: string,
  port: number,
  holder: PortHolder,
  processName: string,
  retry?: () => void
): Promise<void> {
  const confirm = l10n("portUnwedge.confirmKill");
  const choice = await vscode.window.showWarningMessage(
    l10n("portUnwedge.confirmBody", { process: processName, pid: holder.pid, port }),
    { modal: true },
    confirm
  );
  if (choice !== confirm) {
    return;
  }
  const killed = await killProcess(holder.pid);
  if (!killed) {
    vscode.window.showErrorMessage(
      l10n("portUnwedge.killFailed", { process: processName, pid: holder.pid, port })
    );
    return;
  }
  vscode.window.showInformationMessage(
    l10n("portUnwedge.killed", { process: processName, pid: holder.pid, port, name })
  );
  retry?.();
}

// The platform command that lists what holds a port, used to pre-fill the terminal
// when the holder could not be resolved automatically.
function inspectPortCommand(port: number): string {
  return process.platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

// Visible outcome for a finished background run. Failures get an error toast with
// a one-click path to the output channel; successes get a quiet info toast. Never
// silent — completion is feedback the user is waiting on. When the failed output
// suggested a fix command, the toast also offers to run it (WOW #12).
function notifyCompletion(
  name: string,
  outcome: "success" | "failure",
  code: number | null,
  durationMs: number,
  fix?: { command: string; cwd: string }
): void {
  const duration = formatDuration(durationMs);
  if (outcome === "success") {
    vscode.window.showInformationMessage(l10n("run.succeeded", { name, duration }));
    return;
  }
  const showOutput = l10n("run.showOutput");
  // The fix action leads when present (it is the most useful next step), then the
  // always-available Show Output. The button text names the exact command so the
  // user runs it knowingly, not blindly.
  const runFix = fix ? l10n("run.runFix", { command: fix.command }) : undefined;
  const actions = runFix ? [runFix, showOutput] : [showOutput];
  void vscode.window
    .showErrorMessage(
      l10n("run.failed", { name, code: code === null ? "?" : code, duration }),
      ...actions
    )
    .then((choice) => {
      if (choice === showOutput) {
        getOutputChannel().show(true);
      } else if (fix && choice === runFix) {
        // Run the suggested fix in the shared integrated terminal so its output is
        // visible and interactive (a fix like `npm install` may prompt).
        runInTerminal(fix.command, fix.cwd, undefined);
      }
    });
}

// Known patterns: a fix command that a failed tool printed in its own output, so it
// can be offered as a one-click action instead of select/copy/paste (WOW #12). Order
// matters — the explicit "run X to fix" phrasing is the most reliable signal and is
// tried first; the package-manager install lines are the common concrete cases.
// Conservative on purpose: a missed suggestion just means no button (the user still
// has the output), whereas a wrong command offered for one click is worse.
const FIX_PATTERNS: readonly RegExp[] = [
  // "Run `npm install x` to fix", 'try running "yarn add y"', etc. — a quoted command
  // following a run/try/fix verb.
  /(?:run|try running|to fix,?\s*run)[:\s]+[`'"]([^`'"\n]+)[`'"]/i,
  // Bare package-manager install/add suggestions on their own.
  /\b((?:npm|pnpm) install(?:\s+--save(?:-dev)?)?\s+[@\w./-]+)/i,
  /\b(yarn add\s+[@\w./-]+)/i,
  /\b(pip3? install\s+[\w=<>.-]+)/i,
];

// Find the first fix command suggested in run output, trimmed, or undefined when
// none of the known patterns match.
function detectFixCommand(output: string): string | undefined {
  for (const pattern of FIX_PATTERNS) {
    const match = pattern.exec(output);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

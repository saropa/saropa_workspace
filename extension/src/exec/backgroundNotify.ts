// Run-settled notifications for background shortcut runs: extract-and-copy, the
// success and failure toasts, the held-port and suggested-fix actions. Split out of
// backgroundRunner.ts.

import * as vscode from "vscode";

import { formatDuration } from "./runStatus";

import { detectBlockedPort, findPortHolder, killProcess, PortHolder } from "./portUnwedge";

import { l10n } from "../i18n/l10n";
import { getOutputChannel, runInTerminal } from "./terminalRunner";

// Match a shortcut's extract pattern against its background output and copy the result
// to the clipboard with a toast (WOW #16). The first capture group is preferred (so
// `Live at: (https://\S+)` yields just the URL); with no group, the whole match is
// used. The pattern compiles with the "m" flag so `^`/`$` anchor to lines, the
// intuitive choice for pulling one line out of many. An invalid pattern or no match
// is logged to the channel and otherwise ignored — extraction is a convenience, never
// a reason to fail or nag.
export function extractAndCopy(pattern: string, output: string, name: string): void {
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
export async function notifyFailure(
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
          runInTerminal(inspectPortCommand(port), cwd, undefined, name);
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
export function notifyCompletion(
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
        // Run the suggested fix in a fresh terminal so its output is visible and
        // interactive (a fix like `npm install` may prompt).
        runInTerminal(fix.command, fix.cwd, undefined, name);
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

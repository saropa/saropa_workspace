import * as vscode from "vscode";
import { PollResult, pollProcesses, isGroupKillable, buildProcessReportMarkdown } from "../exec/processPoll";
import { readTrendTotals } from "../exec/heartbeat";
import { l10n } from "../i18n/l10n";

// Two-sample poll, then push the data (plus the recent-load sparkline series) to
// the webview. The "sampling" flag lets the panel show progress during the ~1 s the
// two samples take. Returns the result so the caller (DashboardPanel) can cache it —
// Copy report and a future poll both reuse it without re-sampling.
export async function pollProcessesTab(webview: vscode.Webview): Promise<PollResult> {
  void webview.postMessage({ type: "sampling" });
  const result = await pollProcesses();
  const trend = await readTrendTotals(30);
  void webview.postMessage({
    type: "data",
    result,
    trend,
    // Tell the webview which groups expose End task, so it never renders a kill
    // button for an OS/container row.
    killable: Object.fromEntries(result.groups.map((g) => [g.tool, isGroupKillable(g.tool)])),
  });
  return result;
}

// Copy the last poll result to the clipboard as a Markdown report. Reuses the cached
// PollResult from pollProcessesTab rather than re-sampling, so Copy report answers a click
// instantly instead of triggering a second ~1 s two-sample poll.
export async function copyProcessReport(lastResult: PollResult | undefined): Promise<void> {
  if (!lastResult) {
    return;
  }
  await vscode.env.clipboard.writeText(buildProcessReportMarkdown(lastResult));
  vscode.window.showInformationMessage(l10n("monitor.copied"));
}

// End a single named process, only after an explicit confirm that names the exact
// process and PID, and only for a killable (non-OS/container) tool group. The
// monitor never auto-kills and never ends a whole group — ending a process is
// always a deliberate, named human act.
export async function killProcessTab(
  pid: number | undefined,
  name: string | undefined,
  tool: string | undefined,
  onKilled: () => Promise<void>
): Promise<void> {
  if (typeof pid !== "number" || !name || !tool) {
    return;
  }
  if (!isGroupKillable(tool)) {
    vscode.window.showWarningMessage(l10n("monitor.kill.protected", { tool }));
    return;
  }
  const confirm = l10n("monitor.kill.confirmAction");
  const choice = await vscode.window.showWarningMessage(
    l10n("monitor.kill.confirm", { name, pid }),
    { modal: true },
    confirm
  );
  if (choice !== confirm) {
    return;
  }
  try {
    process.kill(pid);
    vscode.window.showInformationMessage(l10n("monitor.kill.done", { name, pid }));
  } catch (err) {
    vscode.window.showErrorMessage(
      l10n("monitor.kill.failed", { name, pid, error: err instanceof Error ? err.message : String(err) })
    );
  }
  // Reflect the change (the row should be gone or its tree reshaped).
  await onKilled();
}

import * as vscode from "vscode";
import { validateReportPath } from "../exec/trendReports";
import { l10n } from "../i18n/l10n";

// User-facing feedback for scheduled fires: a completion toast that names the item
// and its outcome with a one-click "Open report" action, and the startup "N runs
// were missed" offer. Split out of the scheduler so the timer engine stays free of
// window/UI concerns and both surfaces share one report-open path.
//
// The "Open report" action opens the report only after re-validating its path
// against the workspace reports/ folder (validateReportPath), so a stale or crafted
// path can never open an arbitrary file — the same guard the Dashboard uses.

// Open a report file after re-validating it lives inside reports/. Silent no-op when
// the path fails validation (the file was moved/removed, or is outside reports/), and
// the open is wrapped so a file that vanished between validate and open degrades to a
// no-op rather than an unhandled rejection (the caller fires this with `void`).
async function openReport(absPath: string): Promise<void> {
  const safe = validateReportPath(absPath);
  if (!safe) {
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(safe));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    // The report was removed after validation; nothing actionable to surface here.
  }
}

// Surface a completed scheduled run: a toast naming the item and outcome, carrying
// an "Open report" action when the run wrote a report. Success is an information
// toast (a quiet confirmation the run happened at all — previously silent); failure
// is a warning toast. `reportAbsPath` is absent for a run that produced no report
// (a plain file/shell run), and then the toast carries no action.
export async function surfaceRunResult(
  name: string,
  outcome: "success" | "failure",
  reportAbsPath?: string
): Promise<void> {
  const openLabel = l10n("schedule.result.openReport");
  // Success is a quiet information toast; failure is a warning. Called directly on
  // vscode.window (not via a detached function reference) so the binding is explicit.
  // Only offer the Open report action when a report exists to open.
  let choice: string | undefined;
  if (outcome === "success") {
    const message = l10n("schedule.result.success", { name });
    choice = reportAbsPath
      ? await vscode.window.showInformationMessage(message, openLabel)
      : await vscode.window.showInformationMessage(message);
  } else {
    const message = l10n("schedule.result.failure", { name });
    choice = reportAbsPath
      ? await vscode.window.showWarningMessage(message, openLabel)
      : await vscode.window.showWarningMessage(message);
  }
  if (choice === openLabel && reportAbsPath) {
    await openReport(reportAbsPath);
  }
}

// Offer to run scheduled items whose slot elapsed while VS Code was closed (the
// missed items that are NOT opted into silent catch-up). One aggregated toast with a
// "Run now" action that fires them via the supplied callback. Names the single item
// when exactly one was missed; otherwise gives the count.
export async function offerMissedRuns(
  count: number,
  singleName: string | undefined,
  runNow: () => void
): Promise<void> {
  if (count <= 0) {
    return;
  }
  const runLabel = l10n("schedule.missed.runNow");
  const message =
    count === 1 && singleName
      ? l10n("schedule.missed.offerOne", { name: singleName })
      : l10n("schedule.missed.offer", { count: String(count) });
  const choice = await vscode.window.showInformationMessage(message, runLabel);
  if (choice === runLabel) {
    runNow();
  }
}

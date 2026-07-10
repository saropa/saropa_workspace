import * as vscode from "vscode";

// One gate for "a report writer just wrote a file — should an editor be raised for
// it?". Every report path (the captured-shell rituals, project stats, pubspec
// freshness, the routine summary) goes through openReport rather than calling
// showTextDocument itself.
//
// The gate exists because a routine is a recipe of recipes: its members each write
// their own report, and each would raise its own editor. A five-member morning
// routine therefore buried the user under five tabs and left the one document that
// indexes them — the summary — unopened unless something failed. A routine now runs
// its members inside withReportOpenSuppressed and opens the summary itself, so one
// run produces exactly one window.
//
// A module-level counter rather than a parameter, because the report-writing command
// handlers (project stats, pubspec freshness) are reached through
// vscode.commands.executeCommand and receive only their own command arguments —
// there is nowhere to thread a flag. The counter is depth-tracked so an inner
// suppressed scope cannot re-enable opening when it unwinds.
let suppressDepth = 0;

// True while a routine (or any other caller of withReportOpenSuppressed) owns the
// screen. Exported for the unit test; callers use openReport instead of branching.
export function isReportOpenSuppressed(): boolean {
  return suppressDepth > 0;
}

// Run `body` with report auto-open suppressed, restoring the previous state even when
// body throws — a member that fails mid-routine must not leave every later report
// opening into the user's face.
export async function withReportOpenSuppressed<T>(body: () => Promise<T>): Promise<T> {
  suppressDepth += 1;
  try {
    return await body();
  } finally {
    suppressDepth -= 1;
  }
}

// Raise a non-preview editor for a report the caller just wrote, unless an enclosing
// scope has suppressed opens. A no-op under suppression: the enclosing routine opens
// its own consolidated summary, which links this file.
export async function openReport(absPath: string): Promise<void> {
  if (isReportOpenSuppressed()) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

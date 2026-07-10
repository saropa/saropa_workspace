import * as vscode from "vscode";
import { AsyncLocalStorage } from "node:async_hooks";

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
// Suppression is held in an AsyncLocalStorage rather than a module-level flag or
// counter, because the report-writing command handlers (project stats, pubspec
// freshness) are reached through vscode.commands.executeCommand and receive only
// their own command arguments — there is nowhere to thread a flag — while a plain
// module flag would leak across runs: a manual "project stats" click landing in an
// await gap of a scheduled routine would silently open nothing, and an inner
// routine's summary would be swallowed by an outer routine still holding the flag.
// The store scopes suppression to the routine's own async context, so a concurrent
// run outside that context still opens its report.
//
// This relies on the async context surviving executeCommand. It does for a command
// this extension registered: the extension host dispatches a locally-registered
// command in-process, on the calling promise chain. If a future member dispatches
// through a boundary that loses the context, the member simply opens its own report
// as it did before this gate existed — a visible regression, never a lost report.
const suppression = new AsyncLocalStorage<true>();

// True while the calling async context is inside withReportOpenSuppressed. Exported
// for the unit test; callers use openReport instead of branching.
export function isReportOpenSuppressed(): boolean {
  return suppression.getStore() === true;
}

// Run `body` with report auto-open suppressed for its async context. A nested scope
// is a no-op (the store already reads true), and a body that throws unwinds the
// context with it — a member that fails mid-routine must not leave every later
// report opening into the user's face.
export function withReportOpenSuppressed<T>(body: () => Promise<T>): Promise<T> {
  return suppression.run(true, body);
}

// Raise a non-preview editor for a report the caller just wrote, unless the calling
// context has suppressed opens. A no-op under suppression: the enclosing routine
// opens its own consolidated summary, which links this file.
export async function openReport(absPath: string): Promise<void> {
  if (isReportOpenSuppressed()) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

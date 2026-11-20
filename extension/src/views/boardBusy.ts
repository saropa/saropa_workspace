import { l10n } from "../i18n/l10n";

// Why a rule cannot be added from the board right now, as a message key: another rule dialog is
// open, a scan is running, or the page shows an old result. Undefined when it can be added.
export function busyReason(s: { assigning: boolean; scanning: boolean; cached: boolean }): string | undefined {
  return s.assigning ? "releaseBoard.rowMenu.busyDialog" : s.scanning ? "releaseBoard.rowMenu.busyScan" : s.cached ? "releaseBoard.rowMenu.busyStale" : undefined;
}

export const UNDO_PENDING = "releaseBoard.undo.pending";

// The words for a busy key. A half-finished Undo names the bar's Dismiss button and the files left.
export function busyMessage(key: string, remaining: string[]): string {
  return key === UNDO_PENDING ? l10n(key, { dismiss: l10n("releaseBoard.polish.undoDismiss"), count: remaining.length, list: remaining.join(", ") }) : l10n(key);
}

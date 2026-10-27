// Why a rule cannot be added from the board right now, as a message key: another rule dialog is
// open, a scan is running, or the page shows an old result. Undefined when it can be added.
export function busyReason(s: { assigning: boolean; scanning: boolean; cached: boolean }): string | undefined {
  return s.assigning ? "releaseBoard.rowMenu.busyDialog" : s.scanning ? "releaseBoard.rowMenu.busyScan" : s.cached ? "releaseBoard.rowMenu.busyStale" : undefined;
}

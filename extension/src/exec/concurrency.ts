// Pure decision for the in-process single-instance guard: should a fresh run be
// blocked because one of this shortcut's own runs is already in flight? The default
// (allowConcurrent absent/false) blocks; a shortcut opts out by setting allowConcurrent
// true. `running` is the live state from processRegistry, which only tracks
// background / report-capture runs — integrated-terminal and external-window runs
// are fire-and-forget, so `running` is always false for them and they are never
// blocked here (a cross-process lockName guards those instead). Kept pure (no
// vscode / fs imports) so the rule is unit-testable under `node --test`.
export function isConcurrencyBlocked(
  allowConcurrent: boolean | undefined,
  running: boolean
): boolean {
  return !allowConcurrent && running;
}

// The shared ordering that both computeRowStateBadge (shortcutRowDescription.ts,
// the visual trailing badge) and buildAccessibilityLabel (shortcutTreeItem.ts, the
// screen-reader label) resolve a shortcut's leading live state against (#53).
// Extracted from two near-identical ternary chains so the two channels can never
// drift out of agreement about which state wins when more than one is true at once
// (e.g. a shortcut that is both locked and paused reads "locked" in both places,
// never "locked" in one and "paused" in the other). Only the shared top of each
// chain lives here — both call sites still diverge on their own tail (schedule /
// last-run for the badge; missing / untapped for the a11y label), which is
// intentional: those facts have no equivalent in the other channel. See the
// "tails diverge on purpose" comment at each call site.
export const ROW_STATE_PRIORITY = ["stopping", "running", "locked", "paused"] as const;
export type RowStatePriorityKey = (typeof ROW_STATE_PRIORITY)[number];

// Returns the first defined value in ROW_STATE_PRIORITY order (stopping beats
// running beats locked beats paused), or undefined when none of the given states
// are active — the caller then falls through to its own lower-priority tail.
// `values` maps each shared key to the string that should show when that state is
// true; a caller passes undefined for a key that does not apply to the current row.
export function pickHighestPriorityRowState(
  values: Partial<Record<RowStatePriorityKey, string | undefined>>
): string | undefined {
  for (const key of ROW_STATE_PRIORITY) {
    const value = values[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

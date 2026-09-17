import { AdbCommandEntry } from "../model/adbCommandCatalog";
import { l10n } from "../i18n/l10n";

// The Launcher's right-panel run-history list (PLAN_Launcher_Restructure.md, build-order
// step 6). IMPORTANT premise correction: the plan's own text describes this step as wiring
// up "the existing adb run-history table (already built for the standalone Mobile Remote
// Control panel)". That table does not exist — direct investigation of
// remoteControl/remoteControlPanel.ts, remoteControlData.ts and remoteControlShell.ts (plus
// a grep for "history" across the whole remoteControl/ directory) turned up only
// exec/adbRunHistory.ts's `recent()`/`counts()` DATA, consumed solely to bias the standalone
// panel's "Recent" pseudo-group toward the top of its search results
// (remoteControlData.ts's rankRecentAdbEntries/RECENT_GROUP_ID). remoteControlPanel.ts even
// lists "the persistent run-history table" explicitly under its own
// "DELIBERATELY NOT IMPLEMENTED HERE" comment. There is no rendered history list/table
// anywhere in this codebase to reuse — this module and the webview rendering it feed are a
// new, minimal one, not a reuse of an existing component.
//
// Pure by the same rule as launcherCategoryList.ts/launcherAdbItem.ts: no vscode import, so
// it unit-tests directly under Node's test runner. adbRunHistory itself is a plain
// module-level singleton (exec/adbRunHistory.ts), not a VS Code API surface, but its
// `recent()`/`counts()` are read host-side (launcherView.ts) and handed in here as plain
// data, exactly like remoteControlData.ts's own RemoteControlPayloadOptions.recent/counts.

// One row the right panel renders. No `lastRun` timestamp: adbRunHistory.recent() only
// exposes the de-duplicated, most-recent-first list of catalog entry ids — the per-run
// epoch-ms timestamp it tracks internally (AdbRunRecord.at) is deliberately not part of its
// public surface (recent()/counts() are the only reads it exposes), so there is nothing to
// carry here without widening that module's API, which is explicitly out of scope for this
// step ("no change to how adbRunHistory tracks/persists data").
export interface LauncherRunHistoryEntry {
  // The composite "adb:"+entryId id, already prefixed exactly as launcherAdbItem.ts mints
  // it for a catalog card — so the webview can post `{type:'run', id}` verbatim, the same
  // message shape handleAdbItem/the card's Run button already use, without needing to know
  // the "adb:" convention itself.
  readonly id: string;
  readonly label: string;
  // Lifetime run count (adbRunHistory.counts()). A row only ever exists for an id that
  // appears in `recent`, so in practice this is always >= 1 for a real run.
  readonly count: number;
}

// adbRunHistory's own MAX_RECENT is 12 (exec/adbRunHistory.ts), which already bounds
// `recent` below this. This cap is a second, independent belt-and-suspenders bound on what
// the panel actually paints — kept at a rounder, slightly higher number than 12 so a future
// change to MAX_RECENT (or a caller passing a longer `recent` list, e.g. a test) can't
// silently balloon the right panel into a second full catalog scroll; the panel's whole
// point is a short "what did I just run" glance, not a paginated log.
export const RUN_HISTORY_DISPLAY_LIMIT = 20;

// Combine adbRunHistory's recency-ordered ids and lifetime counts with the adb catalog into
// the right panel's display rows, most-recent-first (recent()'s own ordering — this module
// does no re-ranking of its own, unlike remoteControlData.ts's rankRecentAdbEntries, which
// additionally folds in frequency; the plan calls for a run-history list, not a second
// "recent or frequent" ranking).
//
// A `recent` id with no matching catalog entry (a renamed or removed adb command — see
// adbRunHistory.ts's own doc comment: "renaming an entry resets its ranking") is skipped
// rather than crashing or rendering a blank row, mirroring how
// remoteControlData.ts's rankRecentAdbEntries treats the same case.
export function buildRunHistoryEntries(
  catalog: readonly AdbCommandEntry[],
  recent: readonly string[],
  counts: Readonly<Record<string, number>>,
  limit: number = RUN_HISTORY_DISPLAY_LIMIT
): LauncherRunHistoryEntry[] {
  const byId = new Map(catalog.map((e) => [e.id, e] as const));
  const entries: LauncherRunHistoryEntry[] = [];
  for (const entryId of recent) {
    if (entries.length >= limit) {
      break;
    }
    const entry = byId.get(entryId);
    if (!entry) {
      continue;
    }
    entries.push({
      id: `adb:${entry.id}`,
      label: l10n(entry.labelKey),
      count: counts[entryId] ?? 0,
    });
  }
  return entries;
}

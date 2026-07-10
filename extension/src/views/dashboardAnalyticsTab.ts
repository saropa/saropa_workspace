import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Shortcut } from "../model/shortcut";
import { telemetry } from "../exec/telemetry";
import { runStatusRegistry, RunResult, formatDuration } from "../exec/runStatus";
import { l10n } from "../i18n/l10n";
import { recentTag } from "./shortcutRowFormatting";
import { relativeTime } from "./dashboardTrendsTab";

// How many most-run shortcuts to surface, so a heavy user's dashboard stays scannable
// rather than unbounded.
const TOP_SHORTCUTS = 10;

// Build the run-analytics summary from the on-device telemetry store and the
// in-memory session run-status registry — display-ready strings only (l10n is
// host-side), so the webview script renders text without re-localizing. Mirrors the
// Markdown-preview command's content; that command stays as the degraded fallback.
export async function loadAnalyticsTab(webview: vscode.Webview, store: ShortcutStore): Promise<void> {
  if (!telemetry.enabled()) {
    void webview.postMessage({
      type: "analytics",
      enabled: false,
      message: l10n("analytics.disabled"),
    });
    return;
  }
  const counts = telemetry.counts();
  const recent = telemetry.recent();
  const shortcutsRun = Object.keys(counts).length;
  const totalRuns = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (totalRuns === 0 && recent.length === 0) {
    void webview.postMessage({
      type: "analytics",
      enabled: true,
      empty: l10n("analytics.empty"),
    });
    return;
  }

  const mostRun = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_SHORTCUTS)
    .map(([shortcutId, n]) => ({
      name: nameFor(store, shortcutId),
      sub: l10n("analytics.runsLabel", { count: n }),
    }));

  const session = runStatusRegistry
    .entries()
    .sort(([, a], [, b]) => b.endedAt - a.endedAt)
    .map(([shortcutId, result]) => ({
      name: nameFor(store, shortcutId),
      detail: sessionLabel(result),
      ok: result.outcome === "success",
    }));

  const now = Date.now();
  const recentList = recent.map((record) => ({
    name: nameFor(store, record.pinId), // pinId: serialized telemetry-record field — wire token, keep literal

    ago: relativeTime(now, record.at),
    tag: recentTag(record),
  }));

  void webview.postMessage({
    type: "analytics",
    enabled: true,
    totals: {
      shortcuts: l10n("analytics.pinsRun", { count: shortcutsRun }),
      runs: l10n("analytics.totalRuns", { count: totalRuns }),
    },
    mostRun,
    session,
    recent: recentList,
  });
}

// Resolve a recorded shortcut id to a human display name; a run can outlive the
// shortcut that produced it, so fall back to a clear marker rather than leaking the
// opaque id.
function nameFor(store: ShortcutStore, shortcutId: string): string {
  const shortcut: Shortcut | undefined = store.findShortcut(shortcutId);
  if (!shortcut) {
    return l10n("analytics.unknownPin");
  }
  return shortcut.label ?? (shortcut.path.split("/").pop() ?? shortcut.path);
}

function sessionLabel(result: RunResult): string {
  const code = result.exitCode ?? "—";
  if (result.outcome === "success") {
    return l10n("analytics.sessionOk", { duration: formatDuration(result.durationMs), code });
  }
  return l10n("analytics.sessionFailed", { code, duration: formatDuration(result.durationMs) });
}

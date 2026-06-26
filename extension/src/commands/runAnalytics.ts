import * as vscode from "vscode";
import { Pin } from "../model/pin";
import { PinStore } from "../model/pinStore";
import { telemetry, RunRecord } from "../exec/telemetry";
import { runStatusRegistry, RunResult, formatDuration } from "../exec/runStatus";
import { recentTag } from "../views/pinRowFormatting";
import { l10n } from "../i18n/l10n";

// "Run Analytics" summary (roadmap 3.3). A small, on-demand view of pin activity
// built ENTIRELY from the on-device telemetry store (globalState) plus the
// in-memory per-session run-status registry — most-run pins, total runs, the
// session's success / failure split, and last-run times. Purely local: every read
// here is from on-machine state, nothing is transmitted, so it satisfies the
// no-remote-telemetry principle. It respects the same controls as the rest of the
// telemetry: collection off (saropaWorkspace.telemetry.enabled) yields a "turn it
// on" note with nothing to show, and Reset Run History empties it (this reads the
// store live, so a reset is reflected the next time the summary is opened).
//
// Rendered as a read-only Markdown preview via a virtual document, mirroring the
// Simulate Run audit, so there is no temp file to clean up and nothing to edit or
// save by accident.

// How many entries to show in the bounded sections, so a heavy user's summary
// stays scannable rather than listing every pin ever run.
const TOP_PINS = 10;

class AnalyticsPreviewProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "saropa-analytics";

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  // Single virtual document (one summary at a time); keyed by a fixed path so
  // re-running the command refreshes the existing preview instead of stacking tabs.
  private body = "";

  provideTextDocumentContent(): string {
    return this.body;
  }

  async show(content: string): Promise<void> {
    this.body = content;
    const uri = vscode.Uri.from({
      scheme: AnalyticsPreviewProvider.scheme,
      path: "/run-analytics.md",
    });
    this._onDidChange.fire(uri);
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

const preview = new AnalyticsPreviewProvider();

// Register the virtual-document provider that backs the analytics preview. Pushed
// to subscriptions so the provider and its emitter are disposed on deactivation.
export function registerRunAnalytics(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      AnalyticsPreviewProvider.scheme,
      preview
    ),
    preview
  );
}

// Entry point for the "View Run Analytics" command. Builds the Markdown summary
// from the local stores and renders it. The store is used only to resolve pin ids
// to display names — no run data is read from it.
export async function showRunAnalytics(store: PinStore): Promise<void> {
  await preview.show(buildReport(store));
}

// Resolve a recorded pin id to a human display name. A run can outlive the pin
// that produced it (the pin was unpinned since), so fall back to a clear
// "removed pin" marker rather than leaking the opaque id.
function nameFor(store: PinStore, pinId: string): string {
  const pin: Pin | undefined = store.findPin(pinId);
  if (!pin) {
    return l10n("analytics.unknownPin");
  }
  return pin.label ?? (pin.path.split("/").pop() ?? pin.path);
}

// Exported for unit tests: the disabled / empty / populated branches are pure
// over the telemetry store + session registry, so they are asserted directly
// without standing up the virtual-document preview or the extension host.
export function buildReport(store: PinStore): string {
  const lines: string[] = [
    `# ${l10n("analytics.title")}`,
    "",
    `> ${l10n("analytics.intro")}`,
    "",
  ];

  // Collection disabled: there is intentionally nothing to summarize. Say how to
  // turn it back on instead of rendering an empty, confusing report.
  if (!telemetry.enabled()) {
    lines.push(`_${l10n("analytics.disabled")}_`, "");
    return lines.join("\n");
  }

  const counts = telemetry.counts();
  const recent = telemetry.recent();
  const pinsRun = Object.keys(counts).length;
  const totalRuns = Object.values(counts).reduce((sum, n) => sum + n, 0);

  // No runs recorded yet (fresh install or just after a reset): a single prompt to
  // run something is clearer than empty headings.
  if (totalRuns === 0 && recent.length === 0) {
    lines.push(`_${l10n("analytics.empty")}_`, "");
    return lines.join("\n");
  }

  lines.push(
    `## ${l10n("analytics.totalsHeading")}`,
    "",
    `- ${l10n("analytics.pinsRun", { count: pinsRun })}`,
    `- ${l10n("analytics.totalRuns", { count: totalRuns })}`,
    ""
  );

  lines.push(...mostRunSection(store, counts));
  lines.push(...sessionSection(store));
  lines.push(...recentSection(store, recent));

  return lines.join("\n");
}

// Most-run pins, highest lifetime count first, bounded to TOP_PINS so the list
// stays scannable. Ties keep the store's iteration order, which is stable enough
// for a glance ("which shortcuts earn their place").
function mostRunSection(
  store: PinStore,
  counts: Record<string, number>
): string[] {
  const ranked = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_PINS);
  if (ranked.length === 0) {
    return [];
  }
  const out = [`## ${l10n("analytics.mostRunHeading")}`, ""];
  ranked.forEach(([pinId, n], index) => {
    out.push(
      `${index + 1}. **${nameFor(store, pinId)}** — ${l10n("analytics.runsLabel", {
        count: n,
      })}`
    );
  });
  out.push("");
  return out;
}

// The current session's background-run outcomes (success / failure), read from the
// in-memory run-status registry. Per-session by design — it clears on reload — so
// it is labeled as such, separate from the lifetime totals above.
function sessionSection(store: PinStore): string[] {
  const entries = runStatusRegistry.entries();
  if (entries.length === 0) {
    return [];
  }
  // Most-recently-ended first, so the latest result is at the top of the list.
  entries.sort(([, a], [, b]) => b.endedAt - a.endedAt);
  const out = [
    `## ${l10n("analytics.sessionHeading")}`,
    "",
    `_${l10n("analytics.sessionNote")}_`,
    "",
  ];
  for (const [pinId, result] of entries) {
    out.push(`- **${nameFor(store, pinId)}** — ${sessionLabel(result)}`);
  }
  out.push("");
  return out;
}

// One session result as a line: outcome, exit code, and duration.
function sessionLabel(result: RunResult): string {
  const code = result.exitCode ?? "—";
  if (result.outcome === "success") {
    return l10n("analytics.sessionOk", {
      duration: formatDuration(result.durationMs),
      code,
    });
  }
  return l10n("analytics.sessionFailed", {
    code,
    duration: formatDuration(result.durationMs),
  });
}

// The most-recent activity with timestamps, tagged by how each entry landed (a
// manual run is untagged, a scheduled fire and a plain open carry a tag) — the same
// bounded list the Recent sidebar group draws on.
function recentSection(store: PinStore, recent: RunRecord[]): string[] {
  if (recent.length === 0) {
    return [];
  }
  const out = [`## ${l10n("analytics.recentHeading")}`, ""];
  const now = Date.now();
  for (const record of recent) {
    const tagToken = recentTag(record);
    const tag = tagToken ? ` ${tagToken}` : "";
    out.push(
      `- **${nameFor(store, record.pinId)}** — ${relativeTime(now, record.at)}${tag}`
    );
  }
  out.push("");
  return out;
}

// Compact "time ago" for a past timestamp, reusing the Project Files view's
// wording so relative times read the same across the extension. A future or
// just-passed timestamp reads as "just now".
function relativeTime(now: number, then: number): string {
  const deltaMs = Math.max(0, now - then);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return l10n("projectFiles.justNow");
  }
  if (minutes < 60) {
    return l10n("projectFiles.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return l10n("projectFiles.hoursAgo", { count: hours });
  }
  return l10n("projectFiles.daysAgo", { count: Math.floor(hours / 24) });
}

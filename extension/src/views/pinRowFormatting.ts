import { Pin } from "../model/pin";
import { RunResult, formatDuration } from "../exec/runStatus";
import { PinBadge } from "../exec/pinBadges";
import { l10n } from "../i18n/l10n";

// Text formatters for a pin's tree row and hover. Split out of pinTreeItem.ts so the
// item class stays focused on assembling the TreeItem; these are pure label builders
// (string in, string out) and carry no VS Code state, which also makes them unit-
// testable in isolation. Icon/tint resolution is a separate concern in pinRowTokens.ts.

// Compact label for the next-run instant: time-of-day when it is today,
// otherwise a short date plus time. Locale formatting is delegated to the OS so
// the rendered clock matches the user's regional settings.
export function formatNextRun(ts: number): string {
  const next = new Date(ts);
  const now = new Date();
  const sameDay =
    next.getFullYear() === now.getFullYear() &&
    next.getMonth() === now.getMonth() &&
    next.getDate() === now.getDate();
  const time = next.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) {
    return time;
  }
  const date = next.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date} ${time}`;
}

// Compact expiry chip for a time-bombed pin's row (WOW #9): a wall-clock bomb shows
// the time remaining ("2h left"), a branch bomb shows the branch it is tied to. When
// both are set the countdown wins — it is the more concrete, time-sensitive fact.
// The relative time is static per repaint (a TreeView row cannot tick live); it
// re-renders on the next paint, which the expiry sweep and any store change trigger.
export function expirySummary(pin: Pin): string | undefined {
  if (!pin.expires) {
    return undefined;
  }
  if (pin.expires.at !== undefined) {
    return formatTimeLeft(pin.expires.at, Date.now());
  }
  if (pin.expires.onBranchAway !== undefined) {
    return l10n("expiry.chip.branch", { branch: pin.expires.onBranchAway });
  }
  return undefined;
}

// Time remaining until an expiry instant, in the coarsest useful unit. A past/now
// instant reads "due" (the next sweep removes it). Minutes under an hour, hours
// under a day, otherwise whole days.
export function formatTimeLeft(at: number, now: number): string {
  const diffMs = at - now;
  if (diffMs <= 0) {
    return l10n("expiry.left.due");
  }
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return l10n("expiry.left.minutes", { count: Math.max(1, minutes) });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return l10n("expiry.left.hours", { count: hours });
  }
  return l10n("expiry.left.days", { count: Math.round(hours / 24) });
}

// The full expiry instant for the hover, in the user's locale.
export function formatExpiryInstant(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Compact inline badge for the last completed run: "ok 2.3s" on success, or
// "exit 1 2.3s" on failure (a signal-killed run has no code and reads "exit ?").
export function formatRunBadge(result: RunResult): string {
  const duration = formatDuration(result.durationMs);
  if (result.outcome === "success") {
    return l10n("run.statusOk", { duration });
  }
  const code = result.exitCode === null ? "?" : String(result.exitCode);
  return l10n("run.statusFailed", { code, duration });
}

// Fuller last-run line for the tooltip, including the wall-clock time it ended.
export function formatRunTooltip(result: RunResult): string {
  const duration = formatDuration(result.durationMs);
  const time = new Date(result.endedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (result.outcome === "success") {
    return l10n("run.tooltipOk", { duration, time });
  }
  const code = result.exitCode === null ? "?" : String(result.exitCode);
  return l10n("run.tooltipFailed", { code, duration, time });
}

// Full diagnostic breakdown line for the hover, or undefined when the badge carries
// no diagnostic half. A clean sweep reads as "no issues".
export function formatDiagTooltip(badge: PinBadge): string | undefined {
  const hasDiag =
    badge.errors !== undefined ||
    badge.warnings !== undefined ||
    badge.infos !== undefined;
  if (!hasDiag) {
    return undefined;
  }
  return l10n("badge.diagTooltip", {
    errors: badge.errors ?? 0,
    warnings: badge.warnings ?? 0,
    infos: badge.infos ?? 0,
  });
}

// Full test-tally line for the hover, or undefined when the badge carries no test
// half.
export function formatTestTooltip(badge: PinBadge): string | undefined {
  if (badge.testsPassed === undefined && badge.testsFailed === undefined) {
    return undefined;
  }
  return l10n("badge.testTooltip", {
    passed: badge.testsPassed ?? 0,
    failed: badge.testsFailed ?? 0,
  });
}

// One-line summary of a non-file pin's action, shown as the tree row's detail.
export function actionSummary(pin: Pin): string {
  const action = pin.action;
  if (!action) {
    return pin.path;
  }
  switch (action.kind) {
    case "url":
      // Full URLs are unreadable in the narrow sidebar row; show just the host
      // (e.g. "github.com"). The full URL stays in the hover tooltip.
      return urlHost(action.url);
    case "shell":
      return action.shellCommand ?? "";
    case "command":
      return action.commandId ?? "";
    case "macro":
      return l10n("action.macroSteps", { count: action.steps?.length ?? 0 });
    case "routine":
      return l10n("action.routineMembers", { count: action.members?.length ?? 0 });
    default:
      return pin.path;
  }
}

// The host of a URL ("github.com") for the compact sidebar row. Falls back to the
// raw string when it does not parse as a URL, so nothing is lost on a bad value.
export function urlHost(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

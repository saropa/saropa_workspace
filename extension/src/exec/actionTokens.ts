// Workspace path, recipe-token expansion and dated report path helpers shared by the
// action runners. Split out of actionRunner.ts, which re-exports them.

import * as vscode from "vscode";
import * as path from "path";

// The primary workspace folder's absolute path, or undefined with no folder open. The
// cwd fallback for a shell/macro action that carries no explicit cwd of its own.
export function firstWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Expand recipe-time tokens that are not file-scoped: $workspaceRoot, plus the
// date stamps used by report paths. $stamp is filesystem-safe (YYYY.MM.DD_HHmmss)
// for report file names; $date is YYYY-MM-DD for headings; $datedir is the dotted
// calendar date (YYYY.MM.DD) used as a per-day report folder; $time is HHmmss.
// Exported so the dry-run audit (simulateRun) resolves a recipe's shell/cwd the same
// way an actual run does, from this single source of truth rather than a second copy.
export function expandRecipeTokens(value: string): string {
  const root = firstWorkspacePath() ?? "";
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const datedir = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const stamp = `${datedir}_${time}`;
  // $datedir must be replaced before $date — "$date" is a prefix of "$datedir", so the
  // narrower token would otherwise consume the "$date" inside "$datedir".
  return value
    .split("$workspaceRoot").join(root)
    .split("$datedir").join(datedir)
    .split("$stamp").join(stamp)
    .split("$date").join(date)
    .split("$time").join(time);
}

// The per-day report folder and the report file's name prefix. "workspace" tags
// these as Saropa Workspace's own reports — identifiable when several Suite tools
// share one reports/ folder — and sits right after the calendar date in both the
// folder name and the file name. $datedir/$time expand at run time.
const REPORT_DAY = "$datedir_workspace";

// Build a dated report's path relative to the workspace root, from a single
// definition so every recipe and in-process report writer agrees on the layout:
//   reports/<date>_workspace/<date>_workspace_<time>_<suffix>.<ext>
// e.g. reports/2026.06.29_workspace/2026.06.29_workspace_100046_standup.md
export function reportRelativePath(suffix: string, ext = "md"): string {
  return `reports/${REPORT_DAY}/${REPORT_DAY}_$time_${suffix}.${ext}`;
}

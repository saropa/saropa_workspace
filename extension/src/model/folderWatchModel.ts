// Pure model for folder/file/repo watches: modes, the watch record, snapshot diffing,
// scope matching and display labels. No state. Split out of folderWatch.ts (the store),
// which re-exports it.

import * as path from "path";
import { l10n } from "../i18n/l10n";

// Folder/file watches (PLAN_FILE_AND_FOLDER_WATCH): the user asks to be told when
// new files appear in a folder (e.g. "tell me when a new bug report lands in
// bugs/"), or when a specific file changes. Distinct from the cross-file watch
// LINKS in ShortcutExecConfig.runOnSaveGlobs, which RUN a shortcut on save — these
// only NOTIFY (a toast), carry no run, and crucially fire on STARTUP for files
// written while the window was closed. That startup capability is the whole reason
// a baseline snapshot is cached: without a remembered file list there is nothing to
// diff the current contents against when the window opens.

// What a watch reports:
//   - "new"     only files that appeared since the last snapshot (the common
//               "alert me to a new file" case).
//   - "changed" new files AND existing files whose modified-time advanced (also
//               covers the single-file "tell me when this file changes" case).
export type FolderWatchMode = "new" | "changed";

// What kind of thing a watch targets. "folder" (the original, default) watches a
// filesystem folder or file via FolderWatchEngine's fs walk + FileSystemWatcher.
// "repo" watches a linked GitHub repository's open issues/PRs via polling instead
// of a live filesystem event source — see FolderWatchEngine.scanRepoTarget. Both
// kinds share the same store (unseen tally, baseline diff, enable/global/scope) and
// the same Watches tree row, which is the point: a repo watch is "tell me when
// something new lands" applied to a repo instead of a folder, not a separate feature.
export type WatchKind = "folder" | "repo";

// One user-configured folder/file watch: what to watch, in which mode, and which
// projects it alerts in. Persisted verbatim in FolderWatchStore (globalState), read
// by the scan/diff engine and the Watches tree, and mutated via add/update/remove.
export interface FolderWatch {
  // Stable id, used as the live-watcher key and the baseline-cache key.
  id: string;
  // Absolute fsPath of the watched folder or file for kind "folder"; an
  // "owner/repo" slug (e.g. "saropa/saropa-workspace") for kind "repo". Absolute
  // (not workspace-relative) because a folder watch may target a path outside any
  // open folder, and a global watch must resolve identically across windows.
  target: string;
  // Which kind of target this is. Absent on every watch created before this field
  // existed, which reads as "folder" via watchKind() — old data needs no migration.
  kind?: WatchKind;
  // Whether `target` is a single file (snapshot is just that file) or a folder
  // (snapshot is its contained files). Meaningless for kind "repo" (always false).
  // Resolved once at add time so the engine does not re-stat the target's type on
  // every scan.
  isFile: boolean;
  // Display label; defaults to the target basename when absent.
  label?: string;
  // Optional glob (POSIX subset, see globMatch) matched against each contained
  // file's folder-relative forward-slashed path, e.g. "*.md" or "reports/**".
  // Folder watches only; absent means every contained file counts.
  glob?: string;
  mode: FolderWatchMode;
  // A disabled watch is kept (so its config and baseline survive) but neither
  // scanned on startup nor armed with a live watcher.
  enabled: boolean;
  // EXTRA projects this watch alerts in, beyond the project that owns its target, as
  // workspace-folder fsPaths. A watch is ALWAYS local to the project containing its
  // target ("projects watch their own"); alertScopes only adds further projects the
  // user opted in by hand (e.g. a watch on a folder outside any open project, shared
  // into a specific window). undefined and [] are equivalent (no extra projects) —
  // the containing project still alerts either way; to silence a watch entirely,
  // disable it. See watchAlertsIn for the full rule. The gate exists because the
  // watch list lives in window-independent globalState, so without it a single watch
  // toasted in EVERY open window — the "you blasted every project I am running"
  // report (2026-06-28).
  alertScopes?: string[];
  // A global watch alerts in EVERY project window, not just the one owning its
  // target. The deliberate cross-project case and the ONLY reason a watch appears
  // outside its own project; the Watches view marks it distinctly (a globe glyph and
  // a "global" note) so it is never mistaken for a local watch. Absent/false: local
  // to the project(s) that own or opted into it.
  global?: boolean;
  // Repo watches only: alert only on items carrying at least one of these labels
  // (case-insensitive, OR-matched). Absent/empty = no label filter (every open
  // issue/PR alerts, the existing behavior). Ignored for kind "folder".
  filterLabels?: string[];
  // Repo watches only: alert only on items opened by this GitHub login
  // (case-insensitive exact match). Absent/empty = no author filter. Ignored for
  // kind "folder".
  filterAuthor?: string;
}

// Whether a repo-watch item passes the watch's optional label/author filters. A
// watch with no filters set (the common case) matches everything, so existing
// repo watches keep alerting on every open issue/PR unchanged. Both filters are
// AND'ed when both are set (label match AND author match); label matching is OR
// across `filterLabels` (any one label on the item is enough).
export function matchesRepoFilter(
  watch: FolderWatch,
  item: { readonly author: string; readonly labels: readonly string[] }
): boolean {
  const labels = watch.filterLabels;
  if (labels && labels.length > 0) {
    const wanted = new Set(labels.map((l) => l.toLowerCase()));
    if (!item.labels.some((l) => wanted.has(l.toLowerCase()))) {
      return false;
    }
  }
  const author = watch.filterAuthor?.trim();
  if (author && item.author.toLowerCase() !== author.toLowerCase()) {
    return false;
  }
  return true;
}

// One scan result: each watched file's folder-relative path mapped to its
// last-modified time in epoch ms. The cached "watched file list" the plan calls
// for — diffing a fresh scan against the stored one is how new/changed files are
// found, on startup and live.
export type FolderSnapshot = Record<string, number>;

// What a diff turns up: files that are new since the baseline, and (for "changed"
// mode) existing files whose mtime advanced. Deletions are intentionally not
// reported — the feature alerts to arrivals and edits, not removals.
export interface FolderWatchDelta {
  added: string[];
  changed: string[];
}

// Pure diff of two snapshots. `added` = paths in current but not baseline.
// `changed` (mode "changed" only) = paths in both whose current mtime is strictly
// greater than the baseline mtime; "new" mode returns no changed entries. Both
// lists are sorted so the toast lists files deterministically. A first-ever scan
// (no baseline yet) is the ENGINE's concern, not this function's — it must seed the
// baseline silently rather than diff against an empty map and announce every file
// as new; this function faithfully reports everything-as-added for an empty
// baseline, which is exactly what the seed path must avoid calling it for.
export function diffSnapshots(
  baseline: FolderSnapshot,
  current: FolderSnapshot,
  mode: FolderWatchMode
): FolderWatchDelta {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [path, mtime] of Object.entries(current)) {
    const prior = baseline[path];
    if (prior === undefined) {
      added.push(path);
    } else if (mode === "changed" && mtime > prior) {
      changed.push(path);
    }
  }
  added.sort();
  changed.sort();
  return { added, changed };
}

// True when the delta has anything worth toasting. Centralized so the engine and
// any future consumer agree on "is this delta empty".
export function isEmptyDelta(delta: FolderWatchDelta): boolean {
  return delta.added.length === 0 && delta.changed.length === 0;
}

// True when `target` is `folder` itself or nested under it. path.relative yields a
// "../"-prefixed or absolute result when target escapes folder; neither is inside.
// Centralized so the alert-scope rule and its materialization agree on containment.
export function isPathInside(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// True when the watch is marked global (alerts in every project window).
// Centralized so the alert gate, the row marking, and the make-global toggle agree.
export function isGlobalWatch(watch: FolderWatch): boolean {
  return watch.global === true;
}

// The watch's kind, defaulting absent `kind` to "folder" so data written before
// this field existed keeps behaving exactly as it did. Every branch on folder-vs-
// repo behavior (the engine's scan, the tree row, the manage-hub description) reads
// this instead of `watch.kind` directly, so the default lives in one place.
export function watchKind(watch: FolderWatch): WatchKind {
  return watch.kind ?? "folder";
}

// The name to show for a watch: its label when set, otherwise a target-derived
// fallback. A repo watch's target IS its display form ("owner/repo") — running it
// through path.basename would wrongly strip it down to just "repo" — so this is the
// one place every row/menu/toast reads the name from, instead of repeating the
// kind check at each call site.
export function watchDisplayName(watch: FolderWatch): string {
  if (watch.label) {
    return watch.label;
  }
  return watchKind(watch) === "repo" ? watch.target : path.basename(watch.target);
}

// The "kind" word shown for a watch (Folder/File/GitHub repo). A repo watch has no
// file/folder distinction, so it always reads as the repo kind rather than falling
// through to the folder-watch wording. Centralized alongside watchDisplayName so
// the tree row, the launcher card, and the manage-hub quick pick agree on wording
// without each re-deriving the same kind ternary.
export function watchKindLabel(watch: FolderWatch): string {
  return watchKind(watch) === "repo"
    ? l10n("github.kindRepo")
    : watch.isFile
      ? l10n("folderWatch.kindFile")
      : l10n("folderWatch.kindFolder");
}

// The "mode" word shown for a watch (New/Changed/new issues & PRs). A repo watch
// has no new-vs-changed mode — it always means "new issues/PRs" — so it never
// reads `watch.mode`. See watchKindLabel for why this is centralized.
export function watchModeLabel(watch: FolderWatch): string {
  return watchKind(watch) === "repo"
    ? l10n("github.modeNewItems")
    : watch.mode === "changed"
      ? l10n("folderWatch.modeChanged")
      : l10n("folderWatch.modeNew");
}

// The idle-state base icon for a watch's kind (github glyph for a repo watch, eye
// for a folder/file watch). Every state-specific icon (disabled/global/unseen)
// starts from this. See watchKindLabel for why this is centralized.
export function watchBaseIcon(watch: FolderWatch): "github" | "eye" {
  return watchKind(watch) === "repo" ? "github" : "eye";
}

// Whether a watch should raise alerts in a window holding `folderPaths` (the current
// workspace folders). The single source of truth for "does this watch fire here",
// shared by the engine (which gates scanning/arming) and the Watches tree (which
// decides whether to list the row at all). The rule, in order:
//   1. A global watch alerts everywhere.
//   2. A project always watches files inside its own folders — automatic, regardless
//      of alertScopes. This is "projects watch their own": a watch on a project's own
//      bugs/ folder can never read as "not alerting" in that project.
//   3. Otherwise it alerts only in projects the user explicitly opted in
//      (alertScopes) — a watch whose target lives outside the opened project(s).
export function watchAlertsIn(
  watch: FolderWatch,
  folderPaths: string[]
): boolean {
  if (isGlobalWatch(watch)) {
    return true;
  }
  // A repo watch's target is an "owner/repo" slug, not a filesystem path — rule 2
  // ("a project always watches its own files") is meaningless for it, so skip the
  // path-relative check entirely and fall straight to the explicit alertScopes
  // opt-in below. Running isPathInside on a slug happened to fall through to the
  // same alertScopes result, but only by accident.
  if (watchKind(watch) !== "repo" && folderPaths.some((p) => isPathInside(p, watch.target))) {
    return true;
  }
  return (watch.alertScopes ?? []).some((p) => folderPaths.includes(p));
}

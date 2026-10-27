// Folder scan helpers for the watch engine: the directory skip list, the file cap, the
// recursive walk that builds a snapshot, and glob compilation. Split out of
// folderWatchEngine so the engine stays focused on arming watchers and timing.
import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";
import { FolderSnapshot, FolderWatch, matchesRepoFilter } from "../model/folderWatch";
import { fetchOpenRepoItems, parseRepoSlug } from "../github/githubClient";
import { GitHubWatchItem } from "../github/githubTypes";
import { globToRegExp } from "./globMatch";
import { l10n } from "../i18n/l10n";

// Directories never worth crawling for a "new file" alert: VCS internals, package
// caches, and build output churn constantly and would bury a real new file in
// noise. Skipped during the recursive folder walk. A file watch (isFile) bypasses
// the walk entirely, so an explicit watch on a file inside one of these still works.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".dart_tool",
  "build",
  "dist",
  "out",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
]);

// Hard ceiling on files captured per folder scan. A watch aimed at a huge tree
// would otherwise stat tens of thousands of files on every event; the cap keeps a
// misconfigured watch from stalling the window. Reaching it is logged once per
// scan, not toasted, so it never masquerades as a "new files" alert.
const MAX_FILES = 5000;

// Recursive directory walk into `snapshot`, keyed by forward-slashed paths
// relative to the watch root. Stops adding once MAX_FILES is reached.
export async function walkFolder(
  root: string,
  dir: string,
  matcher: RegExp | undefined,
  snapshot: FolderSnapshot,
  output: { appendLine(line: string): void }
): Promise<void> {
  if (Object.keys(snapshot).length >= MAX_FILES) {
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (Object.keys(snapshot).length >= MAX_FILES) {
      output.appendLine(
        l10n("folderWatch.tooManyFiles", { max: MAX_FILES, dir: root })
      );
      return;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walkFolder(root, full, matcher, snapshot, output);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (matcher && !matcher.test(rel)) {
        continue;
      }
      try {
        const stat = await fs.stat(full);
        snapshot[rel] = stat.mtimeMs;
      } catch {
        // A file that vanished between readdir and stat is simply skipped — it is
        // not part of the current contents, so it neither adds nor changes.
      }
    }
  }
}

// Compile the folder-relative glob once per scan. A malformed pattern compiles to
// a never-match so one bad glob disables only that watch's filter, never throws.
export function compileGlob(glob: string): RegExp {
  try {
    return globToRegExp(glob);
  } catch {
    return /$.^/;
  }
}

/** Snapshots a watched file or folder as name to modified-time. A folder is walked recursively, filtered by the watch's glob. */
export async function scanFolderTarget(
  watch: FolderWatch,
  output: { appendLine(line: string): void }
): Promise<FolderSnapshot> {
  if (watch.isFile) {
    const stat = await fs.stat(watch.target);
    return { [path.basename(watch.target)]: stat.mtimeMs };
  }
  const snapshot: FolderSnapshot = {};
  const matcher = watch.glob ? compileGlob(watch.glob) : undefined;
  await walkFolder(watch.target, watch.target, matcher, snapshot, output);
  return snapshot;
}

// Fetch a repo's open issues/PRs and build a snapshot keyed by item ("issue:123"
// / "pr:45") mapped to its updated_at timestamp, so diffSnapshots reports newly-
// opened items exactly like a newly-arrived file (mode is fixed at "new" for repo
// watches — GitHub already has its own notion of "updated"; re-alerting on every
// edit to an existing issue would be noise, not signal). The fetched items are
// also cached (title/URL) for the toast and the row-click open action.
export async function scanRepoTarget(
  watch: FolderWatch
): Promise<{ snapshot: FolderSnapshot; items: GitHubWatchItem[] }> {
  const slug = parseRepoSlug(watch.target);
  if (!slug) {
    throw new Error(`invalid repo slug: ${watch.target}`);
  }
  const fetched = await fetchOpenRepoItems(slug, false);
  // Filter BEFORE caching/snapshotting: a filtered-out item must never enter the
  // baseline or the toast cache, so it can neither trigger a toast now nor appear
  // via the row-click "open newest unseen" action later.
  const items = fetched.filter((item) => matchesRepoFilter(watch, item));
  const snapshot: FolderSnapshot = {};
  for (const item of items) {
    snapshot[item.key] = Date.parse(item.updatedAt) || 0;
  }
  return { snapshot, items };
}

// A repo watch has no live filesystem event source, so it is polled on a fixed
// interval instead of arming a FileSystemWatcher. Read fresh from config on every
// tick (not cached at construction) so editing the setting takes effect on the next
// tick rather than requiring a reload.
export function repoPollIntervalMs(): number {
  const minutes = vscode.workspace
    .getConfiguration("saropaWorkspace")
    .get<number>("github.pollIntervalMinutes", 5);
  return Math.max(1, minutes) * 60_000;
}

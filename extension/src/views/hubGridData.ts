import { FolderWatch, watchKind } from "../model/folderWatchModel";
import { GitHubWatchItem } from "../github/githubTypes";

// Pure host-side shaping for the HubGrid panel: turns the watch list plus the engine's
// per-watch caches into the one flat `load` payload the webview renders. Kept free of
// the vscode API so it runs under node --test and so the panel class stays a thin
// lifecycle wrapper.

// One table row. Carries only what the row displays plus the two ids the host needs to
// resolve it again on click — the URL itself is never sent back by the page, so a
// tampered message cannot make the host open an arbitrary address.
export interface HubGridRow {
  readonly watchId: string;
  readonly repo: string;
  readonly itemKey: string;
  readonly kind: "issue" | "pr";
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly draft: boolean;
  readonly updatedAt: string;
  readonly unseen: boolean;
}

// A repo whose last scan failed. `rateLimited` selects the dedicated rate-limit wording
// (GitHub answers 403, or 429 for secondary limits) over the generic failure text.
export interface HubGridBanner {
  readonly watchId: string;
  readonly repo: string;
  readonly error: string;
  readonly rateLimited: boolean;
}

// The one message the grid page receives; `repos` lists the filter choices and `banners` the repos whose last scan failed.
export interface HubGridPayload {
  readonly type: "load";
  readonly repos: readonly string[];
  readonly rows: readonly HubGridRow[];
  readonly banners: readonly HubGridBanner[];
}

// Where the shaper reads watch state from; the panel passes the store and engine, a
// test passes plain maps.
export interface HubGridSource {
  watches(): readonly FolderWatch[];
  items(watchId: string): readonly GitHubWatchItem[];
  unseen(watchId: string): readonly string[];
  error(watchId: string): string | undefined;
}

// 403 is GitHub's primary rate-limit answer and 429 its secondary one; the scan error
// text starts with the status code (see fetchOpenRepoItems).
function isRateLimited(error: string): boolean {
  return /^(403|429)\b/.test(error);
}

// Newest first: the dashboard answers "what moved lately", and updatedAt (not array
// order or the composite key) is the only chronological signal — see newestRepoItem.
// An unparseable date sorts last rather than throwing.
function byUpdatedDesc(a: HubGridRow, b: HubGridRow): number {
  return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
}

// Flatten every enabled repo watch into rows, in one pass, with the banner list for
// repos whose last scan failed. Disabled watches are skipped: the engine does not
// poll them, so any cache they still hold is stale by construction.
export function buildHubGridPayload(source: HubGridSource): HubGridPayload {
  const repos: string[] = [];
  const rows: HubGridRow[] = [];
  const banners: HubGridBanner[] = [];
  for (const watch of source.watches()) {
    if (watchKind(watch) !== "repo" || !watch.enabled) {
      continue;
    }
    repos.push(watch.target);
    const unseen = new Set(source.unseen(watch.id));
    for (const item of source.items(watch.id)) {
      rows.push({
        watchId: watch.id,
        repo: watch.target,
        itemKey: item.key,
        kind: item.kind,
        number: item.number,
        title: item.title,
        labels: item.labels,
        draft: item.draft === true,
        updatedAt: item.updatedAt,
        unseen: unseen.has(item.key),
      });
    }
    const error = source.error(watch.id);
    if (error !== undefined) {
      banners.push({
        watchId: watch.id,
        repo: watch.target,
        error,
        rateLimited: isRateLimited(error),
      });
    }
  }
  rows.sort(byUpdatedDesc);
  return { type: "load", repos, rows, banners };
}

// Resolve a click's ids back to the cached item. Undefined when the watch or item is
// gone (a poll replaced the cache between render and click) — the caller reports it.
export function findHubGridItem(
  source: HubGridSource,
  watchId: string,
  itemKey: string
): GitHubWatchItem | undefined {
  return source.items(watchId).find((item) => item.key === itemKey);
}

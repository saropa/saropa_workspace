// Shared shapes for the GitHub repo-watch feature (open issues/PRs surfaced through
// the existing Watches view — see model/folderWatch.ts WatchKind "repo").

// One open issue or PR fetched from a linked repo. `key` is the composite id used
// as the FolderSnapshot key ("issue:123" / "pr:45"), so the generic diffSnapshots
// works unchanged across both watch kinds.
export interface GitHubWatchItem {
  readonly key: string;
  readonly kind: "issue" | "pr";
  readonly number: number;
  readonly title: string;
  readonly htmlUrl: string;
  readonly author: string;
  readonly updatedAt: string;
  readonly labels: string[];
  readonly draft?: boolean;
}

// An "owner/repo" slug split into its parts.
export interface RepoSlug {
  readonly owner: string;
  readonly repo: string;
}

// The most recently updated item in a list, by `updatedAt` — NOT by array order.
// The composite keys ("issue:9", "issue:80", "pr:45") the caller may have used to
// select this list sort lexicographically wherever they're diffed/stored
// (diffSnapshots, FolderWatchStore.addUnseen), which is not chronological: string
// comparison puts "issue:80" before "issue:9" (first differing character), and
// every "issue:*" key before any "pr:*" key regardless of recency. Both the
// toast's "Open" action and the row-click "open newest unseen" action need the
// actual newest item, so both funnel through this instead of trusting array
// position. Undefined for an empty list.
export function newestRepoItem(items: readonly GitHubWatchItem[]): GitHubWatchItem | undefined {
  return items.reduce<GitHubWatchItem | undefined>((newest, item) => {
    if (!newest) {
      return item;
    }
    return Date.parse(item.updatedAt) > Date.parse(newest.updatedAt) ? item : newest;
  }, undefined);
}

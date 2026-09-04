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

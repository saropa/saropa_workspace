// Minimal GitHub REST client for the repo-watch feature: parse/validate an
// "owner/repo" slug, get a VS Code-managed auth session, and fetch a repo's open
// issues and PRs. Deliberately narrow — this is not a general GitHub API wrapper,
// just what FolderWatchEngine.scanRepoTarget needs to diff "what's open now"
// against the watch's cached baseline.
import * as vscode from "vscode";
import { GitHubWatchItem, RepoSlug } from "./githubTypes";
import { getOutputChannel } from "../exec/terminalRunner";
import { l10n } from "../i18n/l10n";

const GITHUB_API = "https://api.github.com";

// Matches the VS Code GitHub PR extension's convention: "repo" scope reads issues
// and PRs (including on private repos the user can see); requesting it up front
// avoids a second consent prompt if a linked repo turns out to be private.
const AUTH_SCOPES = ["repo"];

// "owner/repo" — GitHub usernames/orgs and repo names allow alphanumerics, hyphens,
// underscores, and dots; a leading/trailing hyphen or a bare dot segment is invalid
// but rejecting those edge cases is GitHub's job at fetch time, not this validator's.
const SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export function isValidRepoSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug.trim());
}

export function parseRepoSlug(slug: string): RepoSlug | undefined {
  const trimmed = slug.trim();
  if (!isValidRepoSlug(trimmed)) {
    return undefined;
  }
  const [owner, repo] = trimmed.split("/");
  return { owner, repo };
}

// A user declining the sign-in prompt rejects with this VS Code-authored message
// (not a resolved `undefined`) — matched case-insensitively so it is distinguished
// from a genuine auth-provider failure (network error, provider not registered)
// below, which gets logged since it is otherwise invisible to the user.
const DECLINED_MESSAGE_FRAGMENT = "did not consent";

// Silent by default (createIfNone: false) so a scan never pops an auth prompt on
// its own — only the explicit "watch this repo" command asks the user to sign in
// (createIfNone: true, passed via `interactive`). A signed-out scan simply fetches
// unauthenticated, which still works for public repos at a lower rate limit.
async function getToken(interactive: boolean): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession("github", AUTH_SCOPES, {
      createIfNone: interactive,
    });
    return session?.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes(DECLINED_MESSAGE_FRAGMENT)) {
      // A genuine failure (no provider registered, network error mid-handshake),
      // not a decline — log it so "repo watch never shows anything on a private
      // repo" is diagnosable from the output channel instead of a silent
      // fall-through to an unauthenticated (and, for a private repo, 404) fetch.
      getOutputChannel().appendLine(l10n("github.authError", { error: message }));
    }
    return undefined;
  }
}

function buildHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "saropa-workspace",
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  return headers;
}

// Raw shapes for just the fields this client reads. `unknown`-then-narrow at every
// call site, per the project's no-`any` rule.
interface RawUser {
  readonly login?: string;
}
interface RawLabel {
  readonly name?: string;
}
interface RawIssue {
  readonly number?: number;
  readonly title?: string;
  readonly html_url?: string;
  readonly user?: RawUser;
  readonly updated_at?: string;
  readonly labels?: (string | RawLabel)[];
  readonly pull_request?: unknown;
  readonly draft?: boolean;
}

function extractLabels(labels: (string | RawLabel)[] | undefined): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels
    .map((l) => (typeof l === "string" ? l : l.name ?? ""))
    .filter((name) => name.length > 0);
}

function toWatchItem(raw: RawIssue, kind: "issue" | "pr"): GitHubWatchItem | undefined {
  if (typeof raw.number !== "number" || typeof raw.title !== "string") {
    return undefined;
  }
  return {
    key: `${kind}:${raw.number}`,
    kind,
    number: raw.number,
    title: raw.title,
    htmlUrl: raw.html_url ?? "",
    author: raw.user?.login ?? "",
    updatedAt: raw.updated_at ?? new Date(0).toISOString(),
    labels: extractLabels(raw.labels),
    draft: kind === "pr" ? raw.draft === true : undefined,
  };
}

// Below this many remaining requests in the current rate-limit window, a poll logs
// a budget warning. Fixed and absolute (not a percentage of the limit) since it's
// meant to read as "about to be cut off" regardless of whether the caller is on the
// unauthenticated (60/hr) or authenticated (5000/hr) tier — a percentage of 5000
// would fire needlessly early, and a percentage of 60 would fire too late to be
// useful.
const RATE_LIMIT_WARN_THRESHOLD = 10;

// A one-line output-channel warning when a response's rate-limit headers show the
// caller is close to being cut off, or undefined when there's nothing worth
// logging (headers absent, or comfortably above the threshold). Pure and exported
// for testing; fetchOpenRepoItems is the only caller.
export function rateLimitWarning(headers: Headers): string | undefined {
  // Number(null) is 0 (finite) — an absent header must not read as "0 remaining".
  const remainingHeader = headers.get("x-ratelimit-remaining");
  if (remainingHeader === null) {
    return undefined;
  }
  const remaining = Number(remainingHeader);
  const limit = Number(headers.get("x-ratelimit-limit"));
  if (!Number.isFinite(remaining) || remaining > RATE_LIMIT_WARN_THRESHOLD) {
    return undefined;
  }
  const resetHeader = headers.get("x-ratelimit-reset");
  const resetSeconds = Number(resetHeader);
  const resetAt = Number.isFinite(resetSeconds)
    ? new Date(resetSeconds * 1000).toLocaleTimeString()
    : undefined;
  return l10n("github.rateLimitLow", {
    remaining,
    limit: Number.isFinite(limit) ? limit : "?",
    resetAt: resetAt ?? "?",
  });
}

// Fetch every open issue and PR for a repo. GitHub's /issues endpoint returns both
// mixed together (a PR carries a `pull_request` field, a plain issue does not), so
// one call covers issues and PR-title/author/labels; draft status needs the /pulls
// endpoint separately since /issues omits it. `interactive` controls whether a
// missing auth session prompts the user (see getToken) — true only for the
// user-initiated "watch this repo" flow, false for background polling.
export async function fetchOpenRepoItems(
  slug: RepoSlug,
  interactive: boolean
): Promise<GitHubWatchItem[]> {
  const token = await getToken(interactive);
  const headers = buildHeaders(token);
  const base = `${GITHUB_API}/repos/${slug.owner}/${slug.repo}`;

  // Fetch issues and pulls in parallel — the two responses are combined
  // independently, so there is no reason to serialize the round trips.
  const [issuesResp, pullsResp] = await Promise.all([
    fetch(`${base}/issues?state=open&per_page=100&sort=updated`, { headers }),
    fetch(`${base}/pulls?state=open&per_page=100&sort=updated`, { headers }),
  ]);
  if (!issuesResp.ok) {
    throw new Error(`${issuesResp.status} ${issuesResp.statusText}`);
  }
  const rawIssues = (await issuesResp.json()) as RawIssue[];

  // Surface an approaching rate-limit cutoff before it silently starts failing
  // fetches — several watched repos on a short poll interval can burn through the
  // budget, especially unauthenticated (60/hr).
  const warning = rateLimitWarning(issuesResp.headers);
  if (warning) {
    getOutputChannel().appendLine(warning);
  }

  // Draft status is a nice-to-have; a failed /pulls call still leaves the issue
  // list usable, so this degrades rather than throwing.
  const draftByNumber = new Map<number, boolean>();
  if (pullsResp.ok) {
    const rawPulls = (await pullsResp.json()) as RawIssue[];
    for (const p of rawPulls) {
      if (typeof p.number === "number") {
        draftByNumber.set(p.number, p.draft === true);
      }
    }
  }

  const items: GitHubWatchItem[] = [];
  for (const raw of rawIssues) {
    const isPr = raw.pull_request !== undefined;
    const item = toWatchItem(raw, isPr ? "pr" : "issue");
    if (!item) {
      continue;
    }
    items.push(
      isPr && draftByNumber.has(item.number)
        ? { ...item, draft: draftByNumber.get(item.number) }
        : item
    );
  }
  return items;
}

// The repo's issues-list page, used as the "open" fallback when a toast/row click
// has no cached item URL to deep-link to (e.g. after a window reload cleared the
// engine's in-memory item cache).
export function repoIssuesUrl(slug: RepoSlug): string {
  return `https://github.com/${slug.owner}/${slug.repo}/issues`;
}

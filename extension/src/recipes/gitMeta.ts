import * as vscode from "vscode";

// Read repo metadata from a workspace folder's .git directory — no `git` process
// is spawned, the config/HEAD files are read directly, so this works even when git
// is not on PATH. Used by the URL recipes (open the repo, a branch, PRs, CI).

export interface GitRemote {
  // The repo's web base, e.g. https://github.com/owner/repo (no trailing slash,
  // no .git). Branch/PR/issue URLs are built from this.
  webBase: string;
  // Host kind, so host-specific paths differ (GitHub /tree vs GitLab /-/tree).
  host: "github" | "gitlab" | "bitbucket" | "other";
  owner: string;
  repo: string;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

// Parse the `origin` remote URL from .git/config and normalize it to an https web
// base. Handles scp-style (git@host:owner/repo.git), https, and ssh:// forms.
export async function getGitRemote(
  folder: vscode.WorkspaceFolder
): Promise<GitRemote | undefined> {
  const config = await readText(
    vscode.Uri.joinPath(folder.uri, ".git", "config")
  );
  if (!config) {
    return undefined;
  }

  // Find the [remote "origin"] section's url; fall back to the first remote url.
  const originUrl = extractRemoteUrl(config, "origin") ?? extractAnyRemoteUrl(config);
  if (!originUrl) {
    return undefined;
  }
  return normalizeRemote(originUrl);
}

function extractRemoteUrl(config: string, remote: string): string | undefined {
  // Match the named section then its first url= line before the next [section].
  const section = new RegExp(
    `\\[remote "${remote}"\\]([\\s\\S]*?)(?:\\n\\[|$)`,
    "i"
  ).exec(config);
  if (!section) {
    return undefined;
  }
  const url = /\burl\s*=\s*(.+)/.exec(section[1]);
  return url ? url[1].trim() : undefined;
}

function extractAnyRemoteUrl(config: string): string | undefined {
  const url = /\burl\s*=\s*(.+)/.exec(config);
  return url ? url[1].trim() : undefined;
}

// Turn a raw `git remote -v` style URL — scp-style (git@host:owner/repo.git),
// https://, or ssh:// — into a normalized https web base plus a host kind (used to
// pick GitHub/GitLab/Bitbucket-specific paths) and the owner/repo pair. Returns
// undefined for a URL shape none of the three forms match.
export function normalizeRemote(raw: string): GitRemote | undefined {
  let url = raw.trim();
  // scp-style: git@github.com:owner/repo(.git)
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url);
  let host: string;
  let pathPart: string;
  if (scp) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    // https:// or ssh:// — strip scheme and any user@.
    const m = /^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(url);
    if (!m) {
      return undefined;
    }
    host = m[1];
    pathPart = m[2];
  }
  pathPart = pathPart.replace(/\.git$/i, "").replace(/\/+$/, "");
  const slash = pathPart.indexOf("/");
  if (slash < 0) {
    return undefined;
  }
  const owner = pathPart.slice(0, slash);
  const repo = pathPart.slice(slash + 1);
  const kind: GitRemote["host"] = host.includes("github")
    ? "github"
    : host.includes("gitlab")
      ? "gitlab"
      : host.includes("bitbucket")
        ? "bitbucket"
        : "other";
  return {
    webBase: `https://${host}/${pathPart}`,
    host: kind,
    owner,
    repo,
  };
}

// Current branch from .git/HEAD ("ref: refs/heads/<branch>"). Undefined when HEAD
// is detached (a raw sha) or unreadable.
export async function getCurrentBranch(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const head = await readText(vscode.Uri.joinPath(folder.uri, ".git", "HEAD"));
  if (!head) {
    return undefined;
  }
  const ref = /ref:\s*refs\/heads\/(.+)/.exec(head.trim());
  return ref ? ref[1].trim() : undefined;
}

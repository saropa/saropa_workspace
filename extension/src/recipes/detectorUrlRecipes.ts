import * as vscode from "vscode";
import { GitRemote, getCurrentBranch } from "./gitMeta";
import {
  readText,
  url,
  branchUrl,
  compareUrl,
  commitsUrl,
  issuesUrl,
  ciUrl,
  hostName,
  nameFromYaml,
  nameFromToml,
} from "./detectorHelpers";
import { RecipeResult } from "./detectors";

// The URL-opener recipes of the on-demand catalog (1-8, 23, 25): the git-remote-
// derived web views (repo home, branch, PR, commits, issues, CI, releases), the
// deployed site, the package registry / marketplace listings (npm, pub.dev, PyPI,
// VS Marketplace), and the docs site. Split out of detectors.ts so the catalog file
// stays a thin orchestrator; this block pushes onto the caller's `out` array so the
// recipe ordering matches the original inline version. None of these are invented —
// each is derived from .git/config, package.json, a manifest, or mkdocs.yml.
export async function pushUrlRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  remote: GitRemote | undefined,
  out: RecipeResult[]
): Promise<void> {
  // 1-5, 23: git-remote-derived URL recipes.
  if (remote) {
    out.push({
      recipeId: "github.home",
      label: `Open ${remote.repo} on ${hostName(remote)}`,
      description: `Opens the repository home page on ${hostName(remote)}. Derived from the origin remote in .git/config, so it is correct per clone without hand-typing a URL.`,
      icon: "github",
      color: "charts.purple",
      action: url(remote.webBase),
    });
    const branch = await getCurrentBranch(folder);
    if (branch) {
      out.push({
        recipeId: "github.branch",
        label: `Open branch ${branch}`,
        description: `Opens the current branch (${branch}) on the remote's web view. Derived from the origin remote and the checked-out HEAD.`,
        icon: "git-branch",
        action: url(branchUrl(remote, branch)),
      });
      out.push({
        recipeId: "github.pr",
        label: `Open a pull request for ${branch}`,
        description: `Opens the "new pull request / merge request" page pre-filled with the current branch (${branch}). Derived from the origin remote and HEAD.`,
        icon: "git-pull-request",
        action: url(compareUrl(remote, branch)),
      });
      out.push({
        recipeId: "github.commits",
        label: `Open commit history for ${branch}`,
        description: `Opens the commit history for the current branch (${branch}) on the remote's web view. Host-aware, derived from the origin remote and HEAD.`,
        icon: "git-commit",
        action: url(commitsUrl(remote, branch)),
      });
    }
    out.push({
      recipeId: "github.issues",
      label: "Open Issues",
      description: "Opens the project's issue tracker on the remote. Derived from the origin remote in .git/config.",
      icon: "issues",
      action: url(issuesUrl(remote)),
    });
    out.push({
      recipeId: "ci",
      label: remote.host === "gitlab" ? "Open Pipelines" : "Open CI / Actions",
      description: remote.host === "gitlab"
        ? "Opens the GitLab pipelines page for this project. Host-aware, derived from the origin remote."
        : "Opens the CI / Actions page for this project. Host-aware (GitHub Actions / GitLab pipelines), derived from the origin remote.",
      icon: "pulse",
      action: url(ciUrl(remote)),
    });
    if (remote.host === "github" || remote.host === "gitlab") {
      out.push({
        recipeId: "releases",
        label: "Open Releases",
        description: "Opens the releases page on the remote. Derived from the origin remote in .git/config.",
        icon: "tag",
        action: url(
          remote.host === "gitlab"
            ? `${remote.webBase}/-/releases`
            : `${remote.webBase}/releases`
        ),
      });
    }
  }

  // 6: deployed site (package.json homepage that is an external URL).
  const homepage = pkg && typeof pkg.homepage === "string" ? pkg.homepage : undefined;
  if (homepage && /^https?:\/\//i.test(homepage)) {
    out.push({
      recipeId: "deployed",
      label: "Open the deployed site",
      description: "Opens the live deployed site. Detected from the package.json homepage field (an http(s) URL).",
      icon: "globe",
      color: "charts.blue",
      action: url(homepage),
    });
  }

  // 7 / 25: registry vs marketplace listing.
  if (pkg && typeof pkg.name === "string") {
    const name = pkg.name;
    const publisher = typeof pkg.publisher === "string" ? pkg.publisher : undefined;
    if (publisher) {
      out.push({
        recipeId: "store",
        label: "Open the Marketplace listing",
        description: "Opens this extension's Visual Studio Marketplace page. Detected from the package.json publisher and name.",
        icon: "extensions",
        action: url(
          `https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}`
        ),
      });
    } else if (pkg.private !== true) {
      out.push({
        recipeId: "registry",
        label: "Open the npm package page",
        description: "Opens this package's page on npm. Detected from the package.json name (only when the package is not marked private).",
        icon: "package",
        action: url(`https://www.npmjs.com/package/${name}`),
      });
    }
  }
  // pub.dev / PyPI registry listings.
  const pubName = nameFromYaml(await readText(folder, "pubspec.yaml"));
  if (pubName) {
    out.push({
      recipeId: "registry.pub",
      label: "Open the pub.dev page",
      description: "Opens this package's page on pub.dev. Detected from the name field in pubspec.yaml.",
      icon: "package",
      action: url(`https://pub.dev/packages/${pubName}`),
    });
  }
  const pyName = nameFromToml(await readText(folder, "pyproject.toml"));
  if (pyName) {
    out.push({
      recipeId: "registry.pypi",
      label: "Open the PyPI page",
      description: "Opens this project's page on PyPI. Detected from the name in pyproject.toml.",
      icon: "package",
      action: url(`https://pypi.org/project/${pyName}`),
    });
  }

  // 8: docs site (mkdocs site_url).
  const mkdocs = await readText(folder, "mkdocs.yml");
  const siteUrl = mkdocs ? /site_url:\s*(\S+)/.exec(mkdocs)?.[1] : undefined;
  if (siteUrl) {
    out.push({
      recipeId: "docs",
      label: "Open the docs site",
      description: "Opens the project's documentation site. Detected from the site_url field in mkdocs.yml.",
      icon: "book",
      action: url(siteUrl.replace(/['"]/g, "")),
    });
  }
}

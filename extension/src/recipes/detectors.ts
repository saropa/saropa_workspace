import * as vscode from "vscode";
import { PinAction, PinSchedule } from "../model/pin";
import { getCurrentBranch, getGitRemote } from "./gitMeta";
import {
  readText,
  readJson,
  url,
  branchUrl,
  compareUrl,
  commitsUrl,
  issuesUrl,
  ciUrl,
  hostName,
  firstExisting,
  nameFromYaml,
  nameFromToml,
  exists,
} from "./detectorHelpers";
import {
  detectEntryPoint,
  detectDevCommand,
  detectPort,
  hasVersionSource,
} from "./detectorEcosystem";
import { pushRunTargets } from "./detectorRunTargets";

// Roadmap recipe book — detectors. Each looks at well-known files in a workspace
// folder root (never a recursive crawl) and returns zero or more recipes derived
// from what it finds. The store seeds the results as auto-detected pins; removal
// is sticky and they can be restored (mirrors the auto-pin mechanism). Recipes are
// detected, never "created" by a standing button.

// The logical category a recipe belongs to, used to route it into a top-level
// group. Mirrors the recipe book sections: A (open) / B (run) / C+D (workspace) /
// E (scheduled) / F (suite).
export type RecipeCategory =
  | "open"
  | "run"
  | "workspace"
  | "scheduled"
  | "suite"
  | "monitor"
  | "ai";

export interface RecipeResult {
  // Stable per-recipe id (combined with the folder for the pin id), so sticky
  // removal and de-duplication survive reloads.
  recipeId: string;
  label: string;
  // What the recipe does and what it was detected from, surfaced on the
  // single-click detail modal and the tree hover. The label is the short row
  // text; this is the fuller explanation a user reads before running it.
  description?: string;
  icon?: string;
  color?: string;
  // Optional schedule (the scheduled-ritual recipes set this).
  schedule?: PinSchedule;
  // Which logical top-level group the seeded pin lands in, mirroring the recipe
  // book's catalog sections. The store maps each category to its own synthetic
  // group (Recipes: Open / Run / Workspace / Scheduled, and Saropa Suite) instead
  // of piling every recipe into one flat "Recipes" folder. Undefined falls back to
  // "open" (see recipeGroupId in PinStore).
  group?: RecipeCategory;
  // Exactly one of these defines the action:
  filePath?: string; // a file pin, path relative to the folder
  action?: PinAction; // a non-file pin (url / shell / command / macro)
}

// The fs helpers (readText/exists/readJson), action builders (shell/url), package-
// manager + git-URL helpers live in detectorHelpers; the ecosystem probes
// (detectDevCommand/detectPort/…) in detectorEcosystem; the run-target block
// (pushRunTargets) in detectorRunTargets. This file holds the recipe catalog.

// --- the catalog (recipes 1-25) ----------------------------------------

export async function detectOnDemandRecipes(
  folder: vscode.WorkspaceFolder
): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  const pkg = await readJson<Record<string, unknown>>(folder, "package.json");
  const remote = await getGitRemote(folder);

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

  // 9-16: run-target shell recipes per ecosystem.
  await pushRunTargets(folder, pkg, out);

  // 17: entry point (a file pin).
  const entry = await detectEntryPoint(folder, pkg);
  if (entry) {
    out.push({
      recipeId: "entry",
      label: "Open the entry point",
      description: `Opens the application's entry file (${entry}). Detected from the package.json main/module, or the conventional entry path for the project's language.`,
      icon: "symbol-event",
      filePath: entry,
    });
  }

  // 69-72: canonical project docs (file pins). Each is offered only when the file
  // is actually present at the folder root, so a project without a CHANGELOG never
  // shows a dead opener. Standalone openers — the boot macro opens the README as a
  // step, but a direct one-click "open the changelog / license / contributing" is
  // what a reader reaches for outside a boot sequence.
  const docPins: Array<{
    recipeId: string;
    label: string;
    description: string;
    icon: string;
    names: string[];
  }> = [
    {
      recipeId: "doc.readme",
      label: "Open the README",
      description: "Opens the project's README. Detected from a README file at the folder root.",
      icon: "book",
      names: ["README.md", "readme.md", "README"],
    },
    {
      recipeId: "doc.changelog",
      label: "Open the CHANGELOG",
      description: "Opens the project's changelog. Detected from a CHANGELOG file at the folder root.",
      icon: "history",
      names: ["CHANGELOG.md", "changelog.md", "CHANGELOG"],
    },
    {
      recipeId: "doc.license",
      label: "Open the LICENSE",
      description: "Opens the project's license. Detected from a LICENSE file at the folder root.",
      icon: "law",
      names: ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"],
    },
    {
      recipeId: "doc.contributing",
      label: "Open the contributing guide",
      description: "Opens the project's contributing guide. Detected from a CONTRIBUTING file at the folder root.",
      icon: "organization",
      names: ["CONTRIBUTING.md", "contributing.md", "CONTRIBUTING"],
    },
  ];
  for (const doc of docPins) {
    const found = await firstExisting(folder, doc.names);
    if (found) {
      out.push({
        recipeId: doc.recipeId,
        label: doc.label,
        description: doc.description,
        icon: doc.icon,
        filePath: found,
      });
    }
  }

  // 18: set up .env (command pin -> helper command), only when example exists and
  // .env is missing.
  if ((await exists(folder, ".env.example")) && !(await exists(folder, ".env"))) {
    out.push({
      recipeId: "env.setup",
      label: "Set up your .env",
      description: "Copies .env.example to a new .env (never overwriting an existing one), then opens it. Offered only when .env.example is present and .env is missing.",
      icon: "gear",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.setupEnv",
        commandArgs: [folder.uri.fsPath],
      },
    });
  }

  // 19: open all config files (command pin -> helper command).
  out.push({
    recipeId: "config.open",
    label: "Open all config files",
    description: "Opens every recognized config file present in the folder root (tsconfig, eslint, prettier, analysis_options, vite, Makefile, docker-compose, and more) in one action.",
    icon: "settings-gear",
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.openConfigFiles",
      commandArgs: [folder.uri.fsPath],
    },
  });

  // 20: boot sequence (macro): open README, start dev, open localhost.
  const readme = await firstExisting(folder, ["README.md", "readme.md", "README"]);
  const devCommand = await detectDevCommand(folder, pkg);
  if (readme && devCommand) {
    const port = await detectPort(folder, pkg);
    const steps: PinAction["steps"] = [
      { kind: "open", path: vscode.Uri.joinPath(folder.uri, readme).fsPath },
      { kind: "shell", shellCommand: devCommand, cwd: folder.uri.fsPath },
    ];
    if (port) {
      steps.push({ kind: "url", url: `http://localhost:${port}` });
    }
    out.push({
      recipeId: "boot",
      label: "Start working (boot sequence)",
      description: "A macro that opens the README, starts the dev server, and (when a port is known) opens localhost — one action to bring the project up. Detected from the README plus the project's dev command.",
      icon: "rocket",
      color: "charts.green",
      action: { kind: "macro", steps },
    });
  }

  // 21: open localhost.
  const port = await detectPort(folder, pkg);
  if (port) {
    out.push({
      recipeId: "localhost",
      label: `Open localhost:${port}`,
      description: `Opens http://localhost:${port} in the browser. Port detected from vite config, an .env PORT, docker-compose ports, or the framework default.`,
      icon: "browser",
      action: url(`http://localhost:${port}`),
    });
  }

  // 22: copy name@version (command pin -> helper command).
  if (await hasVersionSource(folder, pkg)) {
    out.push({
      recipeId: "copy.version",
      label: "Copy project name@version",
      description: "Writes the project's name@version to the clipboard with a confirming toast. Read from package.json, pubspec.yaml, Cargo.toml, or pyproject.toml.",
      icon: "tag",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.copyVersion",
        commandArgs: [folder.uri.fsPath],
      },
    });
  }

  // 24: run the nearest package script (command pin -> helper command).
  if (pkg && pkg.scripts && typeof pkg.scripts === "object") {
    out.push({
      recipeId: "nearest.script",
      label: "Run a package script",
      description: "Finds the package.json nearest the active file, lists its scripts in a picker, and runs the chosen one in a terminal. Detected from a package.json carrying a scripts block.",
      icon: "play-circle",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.runNearestScript",
        commandArgs: [folder.uri.fsPath],
      },
    });
  }

  // Route each recipe to a logical top-level group by its id, so the catalog no
  // longer lands in one flat "Recipes" folder. Run-target recipes (9-16) and the
  // nearest-script runner are "run"; entry/.env/config/boot/copy are "workspace";
  // everything else here opens a place ("open"). Centralized here (one block) so a
  // new recipe is categorized in the same file it is defined.
  const RUN = new Set([
    "dev", "test", "lint", "build", "install", "typecheck",
    "compose.up", "db.migrate", "nearest.script",
    "format", "clean", "upgrade",
  ]);
  const WORKSPACE = new Set([
    "entry", "env.setup", "config.open", "boot", "copy.version",
  ]);
  for (const r of out) {
    r.group = RUN.has(r.recipeId)
      ? "run"
      : WORKSPACE.has(r.recipeId)
        ? "workspace"
        : "open";
  }

  return out;
}

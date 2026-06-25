import * as vscode from "vscode";
import { PinAction, PinSchedule } from "../model/pin";
import { GitRemote, getCurrentBranch, getGitRemote } from "./gitMeta";

// Roadmap recipe book — detectors. Each looks at well-known files in a workspace
// folder root (never a recursive crawl) and returns zero or more recipes derived
// from what it finds. The store seeds the results as auto-detected pins; removal
// is sticky and they can be restored (mirrors the auto-pin mechanism). Recipes are
// detected, never "created" by a standing button.

export interface RecipeResult {
  // Stable per-recipe id (combined with the folder for the pin id), so sticky
  // removal and de-duplication survive reloads.
  recipeId: string;
  label: string;
  icon?: string;
  color?: string;
  // Optional schedule (the scheduled-ritual recipes set this).
  schedule?: PinSchedule;
  // Exactly one of these defines the action:
  filePath?: string; // a file pin, path relative to the folder
  action?: PinAction; // a non-file pin (url / shell / command / macro)
}

// --- small fs helpers (folder-root only) -------------------------------

async function readText(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(folder.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

async function exists(
  folder: vscode.WorkspaceFolder,
  ...segments: string[]
): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}

async function readJson<T = Record<string, unknown>>(
  folder: vscode.WorkspaceFolder,
  name: string
): Promise<T | undefined> {
  const text = await readText(folder, name);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

// Build a shell-kind action that runs in the folder, visibly, in the terminal.
function shell(folder: vscode.WorkspaceFolder, commandLine: string): PinAction {
  return {
    kind: "shell",
    shellCommand: commandLine,
    cwd: folder.uri.fsPath,
    useIntegratedTerminal: true,
  };
}

function url(target: string): PinAction {
  return { kind: "url", url: target };
}

// Package manager from the lockfile next to package.json; defaults to npm.
async function packageManager(folder: vscode.WorkspaceFolder): Promise<string> {
  if (await exists(folder, "pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (await exists(folder, "yarn.lock")) {
    return "yarn";
  }
  if (await exists(folder, "bun.lockb")) {
    return "bun";
  }
  return "npm";
}

// Host-aware web URLs from a normalized remote.
function branchUrl(r: GitRemote, branch: string): string {
  return r.host === "gitlab"
    ? `${r.webBase}/-/tree/${branch}`
    : `${r.webBase}/tree/${branch}`;
}
function compareUrl(r: GitRemote, branch: string): string {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${branch}`;
    case "bitbucket":
      return `${r.webBase}/pull-requests/new?source=${branch}`;
    default:
      return `${r.webBase}/compare/${branch}?expand=1`;
  }
}
function issuesUrl(r: GitRemote): string {
  return r.host === "gitlab" ? `${r.webBase}/-/issues` : `${r.webBase}/issues`;
}
function ciUrl(r: GitRemote): string {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/pipelines`;
    case "bitbucket":
      return `${r.webBase}/addon/pipelines/home`;
    default:
      return `${r.webBase}/actions`;
  }
}

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
      icon: "github",
      color: "charts.purple",
      action: url(remote.webBase),
    });
    const branch = await getCurrentBranch(folder);
    if (branch) {
      out.push({
        recipeId: "github.branch",
        label: `Open branch ${branch}`,
        icon: "git-branch",
        action: url(branchUrl(remote, branch)),
      });
      out.push({
        recipeId: "github.pr",
        label: `Open a pull request for ${branch}`,
        icon: "git-pull-request",
        action: url(compareUrl(remote, branch)),
      });
    }
    out.push({
      recipeId: "github.issues",
      label: "Open Issues",
      icon: "issues",
      action: url(issuesUrl(remote)),
    });
    out.push({
      recipeId: "ci",
      label: remote.host === "gitlab" ? "Open Pipelines" : "Open CI / Actions",
      icon: "pulse",
      action: url(ciUrl(remote)),
    });
    if (remote.host === "github" || remote.host === "gitlab") {
      out.push({
        recipeId: "releases",
        label: "Open Releases",
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
        icon: "extensions",
        action: url(
          `https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}`
        ),
      });
    } else if (pkg.private !== true) {
      out.push({
        recipeId: "registry",
        label: "Open the npm package page",
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
      icon: "package",
      action: url(`https://pub.dev/packages/${pubName}`),
    });
  }
  const pyName = nameFromToml(await readText(folder, "pyproject.toml"));
  if (pyName) {
    out.push({
      recipeId: "registry.pypi",
      label: "Open the PyPI page",
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
      icon: "symbol-event",
      filePath: entry,
    });
  }

  // 18: set up .env (command pin -> helper command), only when example exists and
  // .env is missing.
  if ((await exists(folder, ".env.example")) && !(await exists(folder, ".env"))) {
    out.push({
      recipeId: "env.setup",
      label: "Set up your .env",
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
      icon: "browser",
      action: url(`http://localhost:${port}`),
    });
  }

  // 22: copy name@version (command pin -> helper command).
  if (await hasVersionSource(folder, pkg)) {
    out.push({
      recipeId: "copy.version",
      label: "Copy project name@version",
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
      icon: "play-circle",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.runNearestScript",
        commandArgs: [folder.uri.fsPath],
      },
    });
  }

  return out;
}

// --- run-target recipes (9-16) -----------------------------------------

async function pushRunTargets(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  out: RecipeResult[]
): Promise<void> {
  const pm = await packageManager(folder);
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  const isDart = (await exists(folder, "pubspec.yaml"));
  const isFlutter = isDart && /(\n|^)\s*flutter:/.test((await readText(folder, "pubspec.yaml")) ?? "");
  const isGo = await exists(folder, "go.mod");
  const isRust = await exists(folder, "Cargo.toml");
  const isPy = (await exists(folder, "pyproject.toml")) || (await exists(folder, "requirements.txt"));

  // 9 dev server
  const dev = await detectDevCommand(folder, pkg);
  if (dev) {
    out.push({ recipeId: "dev", label: "Start dev server", icon: "debug-start", color: "charts.green", action: shell(folder, dev) });
  }

  // 10 tests
  const test =
    scripts.test ? `${pm} test`
    : isDart ? "dart test"
    : isGo ? "go test ./..."
    : isRust ? "cargo test"
    : isPy ? "pytest"
    : undefined;
  if (test) {
    out.push({ recipeId: "test", label: "Run tests", icon: "beaker", action: shell(folder, test) });
  }

  // 11 lint
  const lint =
    (await hasEslint(folder, pkg)) ? `${pm} exec eslint .`
    : isDart ? (isFlutter ? "flutter analyze" : "dart analyze")
    : (await exists(folder, ".golangci.yml")) || (await exists(folder, ".golangci.yaml")) ? "golangci-lint run"
    : isRust ? "cargo clippy"
    : isPy && ((await exists(folder, "ruff.toml")) || /\[tool\.ruff\]/.test((await readText(folder, "pyproject.toml")) ?? "")) ? "ruff check ."
    : undefined;
  if (lint) {
    out.push({ recipeId: "lint", label: "Lint", icon: "checklist", action: shell(folder, lint) });
  }

  // 12 build
  const build =
    scripts.build ? `${pm} run build`
    : isRust ? "cargo build"
    : isFlutter ? "flutter build"
    : (await exists(folder, "Makefile")) && /(\n|^)build:/.test((await readText(folder, "Makefile")) ?? "") ? "make build"
    : undefined;
  if (build) {
    out.push({ recipeId: "build", label: "Build", icon: "tools", action: shell(folder, build) });
  }

  // 13 install deps
  const install =
    pkg ? `${pm} install`
    : (await exists(folder, "poetry.lock")) ? "poetry install"
    : (await exists(folder, "requirements.txt")) ? "pip install -r requirements.txt"
    : isFlutter ? "flutter pub get"
    : isDart ? "dart pub get"
    : isGo ? "go mod download"
    : isRust ? "cargo fetch"
    : undefined;
  if (install) {
    out.push({ recipeId: "install", label: "Install dependencies", icon: "cloud-download", action: shell(folder, install) });
  }

  // 14 typecheck
  if (await exists(folder, "tsconfig.json")) {
    out.push({ recipeId: "typecheck", label: "Type-check", icon: "symbol-type", action: shell(folder, `${pm} exec tsc --noEmit`) });
  } else if (isPy && ((await exists(folder, "mypy.ini")) || /\[tool\.mypy\]/.test((await readText(folder, "pyproject.toml")) ?? ""))) {
    out.push({ recipeId: "typecheck", label: "Type-check", icon: "symbol-type", action: shell(folder, "mypy .") });
  }

  // 15 compose up
  if ((await exists(folder, "docker-compose.yml")) || (await exists(folder, "compose.yaml"))) {
    out.push({ recipeId: "compose.up", label: "Docker compose up", icon: "server-environment", action: shell(folder, "docker compose up") });
  }

  // 16 db migrate
  const migrate = await detectMigrate(folder, pkg);
  if (migrate) {
    out.push({ recipeId: "db.migrate", label: "Run database migration", icon: "database", action: shell(folder, migrate) });
  }
}

// --- detection sub-helpers ---------------------------------------------

async function detectDevCommand(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<string | undefined> {
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  const pm = await packageManager(folder);
  if (scripts.dev) {
    return `${pm} run dev`;
  }
  if (scripts.start) {
    return `${pm} start`;
  }
  if (await exists(folder, "manage.py")) {
    return "python manage.py runserver";
  }
  if (await exists(folder, "pubspec.yaml")) {
    const text = (await readText(folder, "pubspec.yaml")) ?? "";
    if (/(\n|^)\s*flutter:/.test(text)) {
      return "flutter run";
    }
  }
  return undefined;
}

async function detectMigrate(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<string | undefined> {
  if (await exists(folder, "prisma", "schema.prisma")) {
    const pm = await packageManager(folder);
    return `${pm} exec prisma migrate dev`;
  }
  if ((await exists(folder, "alembic.ini")) || (await exists(folder, "migrations", "env.py"))) {
    return "alembic upgrade head";
  }
  if (pkg && /drizzle/.test(JSON.stringify(pkg.devDependencies ?? {}) + JSON.stringify(pkg.dependencies ?? {}))) {
    const pm = await packageManager(folder);
    return `${pm} exec drizzle-kit migrate`;
  }
  if (await exists(folder, "bin", "rails")) {
    return "bin/rails db:migrate";
  }
  return undefined;
}

async function detectEntryPoint(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<string | undefined> {
  const candidates: string[] = [];
  if (pkg) {
    if (typeof pkg.main === "string") {
      candidates.push(pkg.main);
    }
    if (typeof pkg.module === "string") {
      candidates.push(pkg.module);
    }
  }
  candidates.push(
    "lib/main.dart",
    "src/main.rs",
    "src/main.ts",
    "src/index.ts",
    "src/main.py",
    "main.go",
    "main.py"
  );
  for (const candidate of candidates) {
    if (await exists(folder, ...candidate.split("/"))) {
      return candidate;
    }
  }
  return undefined;
}

async function detectPort(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<number | undefined> {
  // .env / .env.example PORT=
  for (const envFile of [".env", ".env.example"]) {
    const text = await readText(folder, envFile);
    const m = text ? /^\s*PORT\s*=\s*(\d{2,5})/m.exec(text) : null;
    if (m) {
      return Number(m[1]);
    }
  }
  // vite config server.port
  for (const cfg of ["vite.config.ts", "vite.config.js", "vite.config.mjs"]) {
    const text = await readText(folder, cfg);
    const m = text ? /port\s*:\s*(\d{2,5})/.exec(text) : null;
    if (m) {
      return Number(m[1]);
    }
  }
  // docker-compose first host port
  for (const cfg of ["docker-compose.yml", "compose.yaml"]) {
    const text = await readText(folder, cfg);
    const m = text ? /-\s*["']?(\d{2,5}):\d{2,5}/.exec(text) : null;
    if (m) {
      return Number(m[1]);
    }
  }
  // Fallback: a web dev script implies the conventional Vite/React port.
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  if (scripts.dev || scripts.start) {
    return 3000;
  }
  return undefined;
}

async function hasEslint(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<boolean> {
  if (pkg && "eslintConfig" in pkg) {
    return true;
  }
  for (const name of [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
  ]) {
    if (await exists(folder, name)) {
      return true;
    }
  }
  return false;
}

async function hasVersionSource(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<boolean> {
  if (pkg && typeof pkg.version === "string") {
    return true;
  }
  return (
    (await exists(folder, "pubspec.yaml")) ||
    (await exists(folder, "Cargo.toml")) ||
    (await exists(folder, "pyproject.toml"))
  );
}

async function firstExisting(
  folder: vscode.WorkspaceFolder,
  names: string[]
): Promise<string | undefined> {
  for (const name of names) {
    if (await exists(folder, name)) {
      return name;
    }
  }
  return undefined;
}

function hostName(r: GitRemote): string {
  switch (r.host) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "the remote";
  }
}

// Minimal name extraction from YAML/TOML without a parser dependency.
function nameFromYaml(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const m = /^name:\s*(\S+)/m.exec(text);
  return m ? m[1].replace(/['"]/g, "") : undefined;
}
function nameFromToml(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  // [project] name = "x" or [tool.poetry] name = "x"
  const m = /name\s*=\s*["']([^"']+)["']/.exec(text);
  return m ? m[1] : undefined;
}

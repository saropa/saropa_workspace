import * as vscode from "vscode";
import type { RecipeResult } from "./detectors";
import { exists, readText, packageManager, shell } from "./detectorHelpers";
import { detectDevCommand, detectMigrate, hasEslint, hasPrettier, detectEcosystemMarkers } from "./detectorEcosystem";

// The ecosystem markers every recipe block below reads from. Detected once so the
// ~10 independent "detect command -> push recipe" blocks don't each re-run the same
// file-exists / manifest checks.
interface EcosystemFlags {
  pm: string;
  scripts: Record<string, string>;
  isDart: boolean;
  isFlutter: boolean;
  isGo: boolean;
  isRust: boolean;
  isPy: boolean;
  // pyproject.toml's text, read once here when the file exists (isPy is true) so
  // the lint/typecheck/format probes below — each of which greps a different
  // [tool.x] table out of the same file — reuse one read instead of each calling
  // readText(folder, "pyproject.toml") independently (previously up to 4 reads of
  // the same file in a single pushRunTargets pass). Undefined when isPy is false
  // (no pyproject.toml at all) or the read failed.
  pyprojectText: string | undefined;
}

// The setup block: which package manager and which language ecosystems are present.
// Read from the manifest and well-known marker files, never invented.
async function detectEcosystemFlags(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<EcosystemFlags> {
  // Computed once here and threaded through every recipe block below via `flags`,
  // so a single pushRunTargets pass calls packageManager() (its own bounded
  // upward directory walk) exactly once rather than once per block.
  const pm = await packageManager(folder);
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  // Reuse the shared marker detection (detectorEcosystem.ts) instead of re-deriving
  // isDart/isFlutter/isGo/isRust here — keeps this file and the ecosystem-aware
  // auto-pin seeding (activation/ecosystemAutoPins.ts) reading the same signal.
  const { isDart, isFlutter, isGo, isRust } = await detectEcosystemMarkers(folder);
  const hasPyproject = await exists(folder, "pyproject.toml");
  const isPy = hasPyproject || (await exists(folder, "requirements.txt"));
  const pyprojectText = hasPyproject ? await readText(folder, "pyproject.toml") : undefined;
  return { pm, scripts, isDart, isFlutter, isGo, isRust, isPy, pyprojectText };
}

// 9-12: dev server, tests, lint, build — the everyday build/test/lint loop.
async function pushBuildTestLintRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  flags: EcosystemFlags,
  out: RecipeResult[]
): Promise<void> {
  const { pm, scripts, isDart, isFlutter, isGo, isRust, isPy, pyprojectText } = flags;

  // 9 dev server — pm/isFlutter already known from `flags`, so this reuses them
  // instead of detectDevCommand re-deriving pm (another lockfile walk) or
  // re-reading pubspec.yaml for the flutter: section.
  const dev = await detectDevCommand(folder, pkg, { pm, isFlutter });
  if (dev) {
    out.push({ recipeId: "dev", label: "Start dev server", description: `Runs the project's dev/watch command (${dev}). Detected from package.json scripts.dev/start, a Django manage.py, or a Flutter project.`, icon: "debug-start", color: "charts.green", action: shell(folder, dev) });
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
    out.push({ recipeId: "test", label: "Run tests", description: `Runs the project's test suite (${test}). Detected from the test runner for the ecosystem (npm test, dart test, go test, cargo test, pytest).`, icon: "beaker", action: shell(folder, test) });
  }

  // 11 lint
  const lint =
    (await hasEslint(folder, pkg)) ? `${pm} exec eslint .`
    : isDart ? (isFlutter ? "flutter analyze" : "dart analyze")
    : (await exists(folder, ".golangci.yml")) || (await exists(folder, ".golangci.yaml")) ? "golangci-lint run"
    : isRust ? "cargo clippy"
    : isPy && ((await exists(folder, "ruff.toml")) || /\[tool\.ruff\]/.test(pyprojectText ?? "")) ? "ruff check ."
    : undefined;
  if (lint) {
    out.push({ recipeId: "lint", label: "Lint", description: `Runs the project's linter (${lint}). Detected from the lint config for the ecosystem (eslint, dart/flutter analyze, golangci-lint, clippy, ruff).`, icon: "checklist", action: shell(folder, lint) });
  }

  // 12 build
  const build =
    scripts.build ? `${pm} run build`
    : isRust ? "cargo build"
    : isFlutter ? "flutter build"
    : (await exists(folder, "Makefile")) && /(\n|^)build:/.test((await readText(folder, "Makefile")) ?? "") ? "make build"
    : undefined;
  if (build) {
    out.push({ recipeId: "build", label: "Build", description: `Runs the project's build command (${build}). Detected from package.json scripts.build, a Makefile build target, cargo, or flutter.`, icon: "tools", action: shell(folder, build) });
  }
}

// 13, 14, 68, 67: install, typecheck, upgrade, clean — dependency and artifact
// management for the project.
async function pushDependencyRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  flags: EcosystemFlags,
  out: RecipeResult[]
): Promise<void> {
  const { pm, scripts, isDart, isFlutter, isGo, isRust, isPy, pyprojectText } = flags;

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
    out.push({ recipeId: "install", label: "Install dependencies", description: `Installs the project's dependencies (${install}). Detected from the lockfile / manifest for the ecosystem (npm/pnpm/yarn/bun, poetry/pip, pub, go, cargo).`, icon: "cloud-download", action: shell(folder, install) });
  }

  // 14 typecheck
  if (await exists(folder, "tsconfig.json")) {
    out.push({ recipeId: "typecheck", label: "Type-check", description: "Runs the TypeScript type checker (tsc --noEmit). Detected from a tsconfig.json in the folder root.", icon: "symbol-type", action: shell(folder, `${pm} exec tsc --noEmit`) });
  } else if (isPy && ((await exists(folder, "mypy.ini")) || /\[tool\.mypy\]/.test(pyprojectText ?? ""))) {
    out.push({ recipeId: "typecheck", label: "Type-check", description: "Runs the Python type checker (mypy). Detected from mypy.ini or a [tool.mypy] section in pyproject.toml.", icon: "symbol-type", action: shell(folder, "mypy .") });
  }

  // 68 upgrade — move dependencies to newer versions (within the manifest's ranges
  // for npm; to latest resolvable for the language tools). Distinct from install
  // (#13), which only restores what the lockfile already pins.
  const upgrade =
    pkg ? `${pm} update`
    : isFlutter ? "flutter pub upgrade"
    : isDart ? "dart pub upgrade"
    : isRust ? "cargo update"
    : isGo ? "go get -u ./... && go mod tidy"
    : undefined;
  if (upgrade) {
    out.push({ recipeId: "upgrade", label: "Upgrade dependencies", description: `Moves the project's dependencies to newer versions (${upgrade}). Distinct from install, which only restores the locked versions. Detected from the manifest for the ecosystem (npm, pub, cargo, go).`, icon: "arrow-up", action: shell(folder, upgrade) });
  }

  // 67 clean — remove build artifacts so the next build starts fresh. Only the
  // tools whose clean is a single, well-known, non-destructive command are offered;
  // there is no universal "clean" for npm, so it is gated on an explicit scripts.clean.
  const clean =
    isFlutter ? "flutter clean"
    : isRust ? "cargo clean"
    : isGo ? "go clean"
    : scripts.clean ? `${pm} run clean`
    : undefined;
  if (clean) {
    out.push({ recipeId: "clean", label: "Clean build artifacts", description: `Removes the project's build output so the next build starts fresh (${clean}). Detected from flutter, cargo, go, or a package.json clean script.`, icon: "trash", action: shell(folder, clean) });
  }
}

// 15, 16: compose up, db migrate — the infrastructure-adjacent recipes.
async function pushInfraRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  flags: EcosystemFlags,
  out: RecipeResult[]
): Promise<void> {
  // 15 compose up
  if ((await exists(folder, "docker-compose.yml")) || (await exists(folder, "compose.yaml"))) {
    out.push({ recipeId: "compose.up", label: "Docker compose up", description: "Brings the Docker Compose stack up (docker compose up). Detected from a docker-compose.yml or compose.yaml in the folder root.", icon: "server-environment", action: shell(folder, "docker compose up") });
  }

  // 16 db migrate — pm already known from `flags`, reused instead of detectMigrate
  // re-deriving it.
  const migrate = await detectMigrate(folder, pkg, flags.pm);
  if (migrate) {
    out.push({ recipeId: "db.migrate", label: "Run database migration", description: `Runs the database migration (${migrate}). Detected from Prisma, Alembic, Drizzle, or Rails markers.`, icon: "database", action: shell(folder, migrate) });
  }
}

// 66 format — the auto-formatter for the ecosystem. Distinct from lint (#11):
// format rewrites style, lint reports problems. Prettier wins for a JS/TS project
// when configured (it formats more than .ts), otherwise the language's own tool.
async function pushFormatRecipe(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  flags: EcosystemFlags,
  out: RecipeResult[]
): Promise<void> {
  const { pm, isDart, isRust, isGo, isPy, pyprojectText } = flags;
  const ruffConfigured = isPy && ((await exists(folder, "ruff.toml")) || /\[tool\.ruff\]/.test(pyprojectText ?? ""));
  const blackConfigured = isPy && /\[tool\.black\]/.test(pyprojectText ?? "");
  const format =
    (await hasPrettier(folder, pkg)) ? `${pm} exec prettier --write .`
    : isDart ? "dart format ."
    : isRust ? "cargo fmt"
    : isGo ? "gofmt -w ."
    : ruffConfigured ? "ruff format ."
    : blackConfigured ? "black ."
    : undefined;
  if (format) {
    out.push({ recipeId: "format", label: "Format code", description: `Rewrites the project's source to its canonical style (${format}). Distinct from lint — this reformats rather than reports. Detected from the formatter config for the ecosystem (prettier, dart format, cargo fmt, gofmt, ruff/black).`, icon: "symbol-color", action: shell(folder, format) });
  }
}

// The "Flutter dance" — the canonical fix for stale build artifacts and dependency
// drift. Implemented as ONE shell command chained with `&&`, NOT a macro: a macro's
// shell steps fire into the terminal without waiting, so they cannot enforce "stop
// if a step fails". `&&` runs each step only when the previous one exits 0, which is
// exactly the "check there are no errors between steps" the dance requires.
function pushFlutterDanceRecipe(flags: EcosystemFlags, folder: vscode.WorkspaceFolder, out: RecipeResult[]): void {
  if (flags.isFlutter) {
    out.push({
      recipeId: "flutter.dance",
      label: "Flutter dance",
      description: "Resets the Flutter project end to end: flutter clean, then flutter pub get, stopping if a step fails (clean && pub get). The standard cure for stale build output and dependency drift.",
      icon: "sync",
      color: "charts.blue",
      subGroup: "flutter",
      action: shell(folder, "flutter clean && flutter pub get"),
    });
  }
}

// Cluster a Flutter project's flutter-prefixed run targets under the "Flutter"
// subfolder (Build & Run > Flutter). Keyed off the command text rather than the
// recipeId so only the genuinely flutter-driven targets move; the dart-tool ones
// (dart test, dart format) stay at the Build & Run root. The dance already carries
// its own subGroup, so re-setting it is a no-op.
function tagFlutterSubgroup(out: RecipeResult[], startIndex: number): void {
  for (const r of out.slice(startIndex)) {
    if (r.action?.shellCommand?.startsWith("flutter ")) {
      r.subGroup = "flutter";
    }
  }
}

// The run-target recipes (catalog 9-16, 66-68): dev / test / lint / build /
// install / typecheck / compose / migrate / format / clean / upgrade. Each is
// derived from the ecosystem's manifest and lockfile, never invented. Split out of
// detectors.ts because this is the densest single block of the catalog; it pushes
// onto the caller's `out` array so ordering matches the original inline version.
export async function pushRunTargets(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  out: RecipeResult[]
): Promise<void> {
  // Recipes this function adds start here; the Flutter post-pass below tags only its
  // own additions (not the URL recipes pushed before it) into the Flutter subgroup.
  const startIndex = out.length;
  const flags = await detectEcosystemFlags(folder, pkg);

  await pushBuildTestLintRecipes(folder, pkg, flags, out);
  await pushDependencyRecipes(folder, pkg, flags, out);
  await pushInfraRecipes(folder, pkg, flags, out);
  await pushFormatRecipe(folder, pkg, flags, out);
  pushFlutterDanceRecipe(flags, folder, out);
  tagFlutterSubgroup(out, startIndex);
}

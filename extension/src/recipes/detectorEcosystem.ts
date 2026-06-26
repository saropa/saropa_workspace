import * as vscode from "vscode";
import { exists, readText, packageManager } from "./detectorHelpers";

// Ecosystem probes shared by the recipe catalog: each inspects well-known
// manifests / config files at the folder root to derive a command or fact (the
// dev command, a migration command, the entry file, the dev port, lint/format
// tooling, a version source). Split out of detectors.ts so the catalog file holds
// recipe definitions and these reusable detectors live together.

// Derive the command that starts the project's dev / watch server, used by the
// "Start dev server" recipe and the boot-sequence macro. Precedence is most-
// specific-first: an explicit package script (dev, then start) wins because the
// author declared it, before falling back to the framework's conventional command
// (Django, Flutter). Returns undefined when nothing matches, so the caller omits
// the recipe rather than inventing a command that would fail.
export async function detectDevCommand(
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

// Derive the database-migration command for the "Run database migration" recipe.
// Each branch keys off a marker unique to one migration tool (Prisma's schema,
// Alembic's ini / migrations env, a Drizzle dependency, Rails' bin/rails), so a
// match is unambiguous. Drizzle is detected from the dependency manifest rather
// than a file because it has no fixed config path. Returns undefined when no known
// migration tool is present.
export async function detectMigrate(
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

// Find the application's entry file for the "Open the entry point" recipe. The
// package.json main / module fields are tried first (the author's declared entry),
// then a fixed list of conventional per-language entry paths. The first candidate
// that actually exists on disk wins, so a stale main field never points the recipe
// at a missing file. Returns undefined when none of the candidates exist.
export async function detectEntryPoint(
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

// Derive the dev-server port so "Open localhost:<port>" and the boot macro point at
// the right address. Sources are tried most-authoritative-first: an explicit PORT in
// .env, then vite's server.port, then the first host port mapped in docker-compose.
// Only when none is declared does it fall back to the conventional Vite/React 3000,
// and only if a web dev/start script exists (so a non-web project gets no port).
export async function detectPort(
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

// Whether ESLint is configured, which decides if the "Lint" run target uses it
// over the language's default linter. True when package.json carries an inline
// eslintConfig OR any of the recognized config file names is present (the flat
// eslint.config.* and the legacy .eslintrc* family are both checked, since a
// project may use either). hasPrettier below mirrors this shape for the formatter.
export async function hasEslint(
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

// Whether Prettier is configured, which lets the "Format code" run target prefer it
// over the language's own formatter (Prettier formats more than a single language's
// files, so when present it is the better default). True on an inline package.json
// prettier key OR any recognized config file name. Mirrors hasEslint.
export async function hasPrettier(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined
): Promise<boolean> {
  if (pkg && "prettier" in pkg) {
    return true;
  }
  for (const name of [
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
  ]) {
    if (await exists(folder, name)) {
      return true;
    }
  }
  return false;
}

// Whether a project name@version can be read, which gates the "Copy name@version"
// recipe so it is offered only when there is a real version to copy. True on a
// package.json version field, or the presence of a manifest the copy command knows
// how to parse (pubspec.yaml, Cargo.toml, pyproject.toml). Existence here mirrors
// the manifests the copy command reads, so the gate never offers a version it
// cannot actually produce.
export async function hasVersionSource(
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

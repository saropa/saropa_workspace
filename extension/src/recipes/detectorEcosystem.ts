import * as vscode from "vscode";
import { exists, readText, packageManager } from "./detectorHelpers";

// Ecosystem probes shared by the recipe catalog: each inspects well-known
// manifests / config files at the folder root to derive a command or fact (the
// dev command, a migration command, the entry file, the dev port, lint/format
// tooling, a version source). Split out of detectors.ts so the catalog file holds
// recipe definitions and these reusable detectors live together.

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

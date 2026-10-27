// File probes for the scheduled recipes: read/exists helpers and the linter, test
// and outdated-package detectors. Split out of scheduledRecipes.ts.

import * as vscode from "vscode";

export async function readText(
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

export async function exists(
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

// A disabled daily schedule at the suggested time (the user enables on promote).

export async function detectLinter(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const analysis = await readText(folder, "analysis_options.yaml");
  if (analysis !== undefined) {
    const isFlutter = (await readText(folder, "pubspec.yaml"))?.match(/(\n|^)\s*flutter:/);
    // saropa_lints / custom_lint rules only fire under `custom_lint`, not analyze.
    const usesCustomLint = /custom_lint|saropa_lints/.test(analysis);
    const base = isFlutter ? "flutter analyze" : "dart analyze";
    return usesCustomLint ? `${base} && dart run custom_lint` : base;
  }
  if (await hasAny(folder, [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"])) {
    return "npx eslint .";
  }
  if ((await exists(folder, "ruff.toml")) || /\[tool\.ruff\]/.test((await readText(folder, "pyproject.toml")) ?? "")) {
    return "ruff check .";
  }
  if ((await exists(folder, ".golangci.yml")) || (await exists(folder, ".golangci.yaml"))) {
    return "golangci-lint run";
  }
  if (await exists(folder, "Cargo.toml")) {
    return "cargo clippy";
  }
  return undefined;
}

export async function detectTest(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const pkg = await readText(folder, "package.json");
  if (pkg && /"test"\s*:/.test(pkg)) {
    return "npm test";
  }
  if (await exists(folder, "pubspec.yaml")) {
    return "dart test";
  }
  if (await exists(folder, "Cargo.toml")) {
    return "cargo test";
  }
  if (await exists(folder, "go.mod")) {
    return "go test ./...";
  }
  if ((await exists(folder, "pyproject.toml")) || (await exists(folder, "pytest.ini"))) {
    return "pytest";
  }
  return undefined;
}

export async function detectOutdated(
  folder: vscode.WorkspaceFolder
): Promise<string | undefined> {
  if (await exists(folder, "package.json")) {
    return "npm outdated; npm audit";
  }
  if (await exists(folder, "pubspec.yaml")) {
    return "dart pub outdated";
  }
  if ((await exists(folder, "requirements.txt")) || (await exists(folder, "pyproject.toml"))) {
    return "pip list --outdated";
  }
  if (await exists(folder, "Cargo.toml")) {
    return "cargo outdated";
  }
  if (await exists(folder, "go.mod")) {
    return "go list -u -m all";
  }
  return undefined;
}

export async function hasAny(
  folder: vscode.WorkspaceFolder,
  names: string[]
): Promise<boolean> {
  for (const name of names) {
    if (await exists(folder, name)) {
      return true;
    }
  }
  return false;
}

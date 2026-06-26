import * as vscode from "vscode";
import * as path from "path";
import { showLintsHealthScore } from "../exec/lintsHealth";
import { l10n } from "../i18n/l10n";

// Helper commands invoked by the "command" recipes (set up .env, open all config
// files, copy name@version, run the nearest package script). Registered once at
// activation. Each takes the originating folder path as its first argument (the
// recipe stores it in commandArgs), or falls back to the first workspace folder.

export function registerRecipeCommands(context: vscode.ExtensionContext): void {
  const reg = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  reg("saropaWorkspace.recipe.setupEnv", (folderPath?: unknown) =>
    setupEnv(asFolderUri(folderPath))
  );
  reg("saropaWorkspace.recipe.openConfigFiles", (folderPath?: unknown) =>
    openConfigFiles(asFolderUri(folderPath))
  );
  reg("saropaWorkspace.recipe.copyVersion", (folderPath?: unknown) =>
    copyVersion(asFolderUri(folderPath))
  );
  reg("saropaWorkspace.recipe.runNearestScript", (folderPath?: unknown) =>
    runNearestScript(asFolderUri(folderPath))
  );
  // Reads the Saropa Lints public API and reports the exact Code Health score
  // (recipe book #26, #36-40). Self-contained — no folder arg.
  reg("saropaWorkspace.recipe.lintsHealth", () => showLintsHealthScore());
}

function asFolderUri(folderPath?: unknown): vscode.Uri | undefined {
  if (typeof folderPath === "string" && folderPath.length > 0) {
    return vscode.Uri.file(folderPath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// Copy .env.example to .env (never overwriting an existing .env) and open it.
async function setupEnv(folder: vscode.Uri | undefined): Promise<void> {
  if (!folder) {
    return;
  }
  const example = vscode.Uri.joinPath(folder, ".env.example");
  const target = vscode.Uri.joinPath(folder, ".env");
  if (await fileExists(target)) {
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(l10n("recipe.env.exists"));
    return;
  }
  try {
    await vscode.workspace.fs.copy(example, target, { overwrite: false });
  } catch {
    vscode.window.showWarningMessage(l10n("recipe.env.failed"));
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(l10n("recipe.env.done"));
}

// Open every recognized config file that exists in the folder root.
const CONFIG_FILES = [
  "tsconfig.json",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  ".prettierrc",
  ".prettierrc.json",
  "biome.json",
  ".editorconfig",
  "analysis_options.yaml",
  "pyproject.toml",
  "ruff.toml",
  ".golangci.yml",
  "vite.config.ts",
  "vite.config.js",
  "Makefile",
  "docker-compose.yml",
  ".env.example",
];

async function openConfigFiles(folder: vscode.Uri | undefined): Promise<void> {
  if (!folder) {
    return;
  }
  let opened = 0;
  for (const name of CONFIG_FILES) {
    const uri = vscode.Uri.joinPath(folder, name);
    if (await fileExists(uri)) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
      opened++;
    }
  }
  vscode.window.showInformationMessage(
    opened > 0 ? l10n("recipe.config.opened", { count: opened }) : l10n("recipe.config.none")
  );
}

// Read name@version from the folder's manifest and put it on the clipboard.
async function copyVersion(folder: vscode.Uri | undefined): Promise<void> {
  if (!folder) {
    return;
  }
  const value = await readNameVersion(folder);
  if (!value) {
    vscode.window.showWarningMessage(l10n("recipe.version.none"));
    return;
  }
  await vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(l10n("recipe.version.copied", { value }));
}

async function readNameVersion(folder: vscode.Uri): Promise<string | undefined> {
  const pkgText = await readText(vscode.Uri.joinPath(folder, "package.json"));
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { name?: string; version?: string };
      if (pkg.name && pkg.version) {
        return `${pkg.name}@${pkg.version}`;
      }
    } catch {
      // fall through to other manifests
    }
  }
  const pubspec = await readText(vscode.Uri.joinPath(folder, "pubspec.yaml"));
  if (pubspec) {
    const name = /^name:\s*(\S+)/m.exec(pubspec)?.[1];
    const version = /^version:\s*(\S+)/m.exec(pubspec)?.[1];
    if (name && version) {
      return `${name}@${version}`;
    }
  }
  for (const manifest of ["Cargo.toml", "pyproject.toml"]) {
    const text = await readText(vscode.Uri.joinPath(folder, manifest));
    if (text) {
      const name = /name\s*=\s*["']([^"']+)["']/.exec(text)?.[1];
      const version = /version\s*=\s*["']([^"']+)["']/.exec(text)?.[1];
      if (name && version) {
        return `${name}@${version}`;
      }
    }
  }
  return undefined;
}

// Find the package.json nearest the active editor (walking up to the workspace
// folder), then QuickPick its scripts and run the chosen one in a terminal.
async function runNearestScript(fallback: vscode.Uri | undefined): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri;
  const base = active ?? fallback;
  if (!base) {
    return;
  }
  const wsFolder = vscode.workspace.getWorkspaceFolder(base) ?? { uri: fallback } as vscode.WorkspaceFolder;
  const pkgUri = await findNearestPackageJson(base, wsFolder.uri);
  if (!pkgUri) {
    vscode.window.showWarningMessage(l10n("recipe.script.none"));
    return;
  }
  const text = await readText(pkgUri);
  let scripts: Record<string, string> = {};
  try {
    scripts = ((text ? JSON.parse(text) : {}).scripts as Record<string, string>) ?? {};
  } catch {
    scripts = {};
  }
  const names = Object.keys(scripts);
  if (names.length === 0) {
    vscode.window.showWarningMessage(l10n("recipe.script.none"));
    return;
  }
  const pick = await vscode.window.showQuickPick(
    names.map((n) => ({ label: n, description: scripts[n] })),
    { placeHolder: l10n("recipe.script.placeholder") }
  );
  if (!pick) {
    return;
  }
  const dir = path.dirname(pkgUri.fsPath);
  const terminal = vscode.window.createTerminal({ name: l10n("recipe.script.terminal"), cwd: dir });
  terminal.show(true);
  terminal.sendText(`npm run ${pick.label}`);
}

async function findNearestPackageJson(
  start: vscode.Uri,
  stopAt: vscode.Uri
): Promise<vscode.Uri | undefined> {
  let dir = path.dirname(start.fsPath);
  const stop = stopAt.fsPath;
  // Walk up until the workspace folder root (inclusive), looking for package.json.
  for (let i = 0; i < 50; i++) {
    const candidate = vscode.Uri.file(path.join(dir, "package.json"));
    if (await fileExists(candidate)) {
      return candidate;
    }
    if (dir === stop || path.dirname(dir) === dir) {
      break;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

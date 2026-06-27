import * as vscode from "vscode";
import { ShortcutAction } from "../model/shortcut";
import { firstExisting, exists } from "./detectorHelpers";
import {
  detectEntryPoint,
  detectDevCommand,
  detectPort,
  hasVersionSource,
} from "./detectorEcosystem";
import { RecipeResult } from "./detectors";

// The workspace-action recipes of the on-demand catalog (17-22, 24, 69-72): the
// entry-point opener, the canonical doc openers (README / CHANGELOG / LICENSE /
// CONTRIBUTING), the .env setup, the open-all-config action, the boot-sequence
// macro, the localhost opener, copy name@version, and the nearest-package-script
// runner. Split out of detectors.ts so the catalog file stays a thin orchestrator;
// this block pushes onto the caller's `out` array so the recipe ordering matches the
// original inline version.
export async function pushWorkspaceRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  out: RecipeResult[]
): Promise<void> {
  // Each helper pushes its own recipe category onto `out`; they run strictly in this order
  // so the catalog ordering matches the original single-function version. Split by category
  // only to keep each piece under the function-length cap.
  await pushEntryRecipe(folder, pkg, out);
  await pushDocRecipes(folder, out);
  await pushEnvAndConfigRecipes(folder, out);
  await pushBootAndLocalhostRecipes(folder, pkg, out);
  await pushVersionAndScriptRecipes(folder, pkg, out);
}

// 17: entry point (a file shortcut).
async function pushEntryRecipe(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  out: RecipeResult[]
): Promise<void> {
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
}

// 69-72: canonical project docs (file shortcuts). Each is offered only when the file
// is actually present at the folder root, so a project without a CHANGELOG never
// shows a dead opener. Standalone openers — the boot macro opens the README as a
// step, but a direct one-click "open the changelog / license / contributing" is
// what a reader reaches for outside a boot sequence.
async function pushDocRecipes(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  const docShortcuts: Array<{
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
  for (const doc of docShortcuts) {
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
}

// 18-19: the .env setup helper and the open-all-config-files action.
async function pushEnvAndConfigRecipes(
  folder: vscode.WorkspaceFolder,
  out: RecipeResult[]
): Promise<void> {
  // 18: set up .env (command shortcut -> helper command), only when example exists and
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

  // 19: open all config files (command shortcut -> helper command).
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
}

// 20-21: the boot-sequence macro (open README, start dev, open localhost) and the
// standalone localhost opener.
async function pushBootAndLocalhostRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  out: RecipeResult[]
): Promise<void> {
  // 20: boot sequence (macro): open README, start dev, open localhost.
  const readme = await firstExisting(folder, ["README.md", "readme.md", "README"]);
  const devCommand = await detectDevCommand(folder, pkg);
  if (readme && devCommand) {
    const port = await detectPort(folder, pkg);
    const steps: ShortcutAction["steps"] = [
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
      action: { kind: "url", url: `http://localhost:${port}` },
    });
  }
}

// 22, 24: copy the project name@version, and run the nearest package script.
async function pushVersionAndScriptRecipes(
  folder: vscode.WorkspaceFolder,
  pkg: Record<string, unknown> | undefined,
  out: RecipeResult[]
): Promise<void> {
  // 22: copy name@version (command shortcut -> helper command).
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

  // 24: run the nearest package script (command shortcut -> helper command).
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
}

// Tests for the helper commands the command recipes run: env setup, open config files, copy
// name@version and run the nearest package script.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as vscode from "./_stub/vscode";
import {
  Uri, __registeredCommands, __openedDocuments, __resetOpenedDocuments, __infoMessages, __resetInfo,
  __warningMessages, __resetWarnings, __setPickHandler, __resetHandlers, __terminals, __resetShell, __resetEnv,
} from "./_stub/vscode";
import { registerRecipeCommands } from "../recipes/recipeCommands";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
const windowApi = vscode.window as unknown as { activeTextEditor: unknown };
const run = (id: string, arg?: unknown): Promise<unknown> => Promise.resolve(__registeredCommands().get(`saropaWorkspace.recipe.${id}`)!(arg));

beforeEach(() => {
  fx = createFsFixture("sw-recipecmd-");
  registerRecipeCommands(registrarContext());
});

afterEach(() => {
  windowApi.activeTextEditor = undefined;
  fx.remove();
  __resetOpenedDocuments();
  __resetInfo();
  __resetWarnings();
  __resetHandlers();
  __resetShell();
  __resetEnv();
});

test("it registers exactly the five recipe helper commands", () => {
  const ids = captureRegistrations(() => registerRecipeCommands(registrarContext()));
  assert.deepEqual(ids, [
    "saropaWorkspace.recipe.setupEnv",
    "saropaWorkspace.recipe.openConfigFiles",
    "saropaWorkspace.recipe.copyVersion",
    "saropaWorkspace.recipe.runNearestScript",
    "saropaWorkspace.recipe.lintsHealth",
  ]);
});

test("setupEnv copies .env.example to .env, opens it and says so", async () => {
  fx.write(".env.example", "A=1\n");
  await run("setupEnv", fx.dir);
  assert.equal(nodeFs.readFileSync(`${fx.dir}/.env`, "utf8"), "A=1\n");
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/.env`]);
  assert.deepEqual(__infoMessages(), [l10n("recipe.env.done")]);
});

test("setupEnv never overwrites an existing .env; it opens it", async () => {
  fx.write(".env.example", "A=1\n");
  fx.write(".env", "MINE=1\n");
  await run("setupEnv", fx.dir);
  assert.equal(nodeFs.readFileSync(`${fx.dir}/.env`, "utf8"), "MINE=1\n");
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/.env`]);
  assert.deepEqual(__infoMessages(), [l10n("recipe.env.exists")]);
});

test("setupEnv warns and opens nothing when .env.example is missing", async () => {
  await run("setupEnv", fx.dir);
  assert.deepEqual(__warningMessages(), [l10n("recipe.env.failed")]);
  assert.deepEqual(__openedDocuments(), []);
  assert.equal(nodeFs.existsSync(`${fx.dir}/.env`), false);
});

test("a command with no folder argument uses the first workspace folder", async () => {
  fx.write(".env.example", "B=2\n");
  await run("setupEnv");
  assert.equal(nodeFs.readFileSync(`${fx.dir}/.env`, "utf8"), "B=2\n");
});

test("with no folder argument and no workspace folder, nothing happens", async () => {
  vscode.__setWorkspaceFolders(undefined);
  await run("setupEnv");
  await run("openConfigFiles");
  await run("copyVersion");
  assert.deepEqual([__openedDocuments(), __infoMessages(), __warningMessages()], [[], [], []]);
});

test("openConfigFiles opens the config files that exist, in catalog order, and counts them", async () => {
  fx.write("Makefile");
  fx.write("tsconfig.json");
  fx.write("README.md");
  await run("openConfigFiles", fx.dir);
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/tsconfig.json`, `${fx.dir}/Makefile`]);
  assert.deepEqual(__infoMessages(), [l10n("recipe.config.opened", { count: 2 })]);
});

test("openConfigFiles with none present says so", async () => {
  await run("openConfigFiles", fx.dir);
  assert.deepEqual(__openedDocuments(), []);
  assert.deepEqual(__infoMessages(), [l10n("recipe.config.none")]);
});

test("copyVersion prefers package.json, then pubspec, then Cargo and pyproject", async () => {
  const copied = async (): Promise<string> => {
    await run("copyVersion", fx.dir);
    return vscode.env.clipboard.readText();
  };
  fx.write("pyproject.toml", 'name = "py"\nversion = "4.0.0"\n');
  assert.equal(await copied(), "py@4.0.0");
  fx.write("Cargo.toml", 'name = "crate"\nversion = "3.0.0"\n');
  assert.equal(await copied(), "crate@3.0.0");
  fx.write("pubspec.yaml", "name: dartpkg\nversion: 2.0.0\n");
  assert.equal(await copied(), "dartpkg@2.0.0");
  fx.write("package.json", '{ "name": "jspkg", "version": "1.0.0" }');
  assert.equal(await copied(), "jspkg@1.0.0");
  assert.equal(__infoMessages().at(-1), l10n("recipe.version.copied", { value: "jspkg@1.0.0" }));
});

test("a package.json that is broken or lacks a version falls through to the next manifest", async () => {
  fx.write("package.json", "{ not json");
  fx.write("pubspec.yaml", "name: dartpkg\nversion: 2.0.0\n");
  await run("copyVersion", fx.dir);
  assert.equal(await vscode.env.clipboard.readText(), "dartpkg@2.0.0");
  fx.write("package.json", '{ "name": "only-name" }');
  await run("copyVersion", fx.dir);
  assert.equal(await vscode.env.clipboard.readText(), "dartpkg@2.0.0");
});

test("copyVersion with no manifest warns and leaves the clipboard alone", async () => {
  await run("copyVersion", fx.dir);
  assert.deepEqual(__warningMessages(), [l10n("recipe.version.none")]);
  assert.equal(await vscode.env.clipboard.readText(), "");
});

function activeFile(rel: string): void {
  windowApi.activeTextEditor = { document: { uri: Uri.file(`${fx.dir}/${rel}`) } };
}

test("runNearestScript lists the scripts of the nearest package.json and runs the pick in a terminal there", async () => {
  fx.write("package.json", '{ "scripts": { "root": "x" } }');
  fx.write("pkg/package.json", '{ "scripts": { "build": "tsc", "test:watch": "node --test --watch" } }');
  fx.write("pkg/src/a.ts");
  activeFile("pkg/src/a.ts");
  let offered: unknown;
  let options: unknown;
  __setPickHandler(async (items, opts) => {
    offered = items;
    options = opts;
    return (items as unknown[])[1];
  });
  await run("runNearestScript", fx.dir);
  assert.deepEqual(offered, [{ label: "build", description: "tsc" }, { label: "test:watch", description: "node --test --watch" }]);
  assert.deepEqual(options, { placeHolder: l10n("recipe.script.placeholder") });
  const [terminal] = __terminals();
  assert.deepEqual(terminal.options, { name: l10n("recipe.script.terminal"), cwd: `${fx.dir}/pkg` });
  assert.deepEqual(terminal.sentTexts, ["npm run test:watch"]);
  assert.deepEqual(terminal.shownWith, [true]);
});

test("the package manager comes from the lockfile next to the nearest package.json", async () => {
  fx.write("pkg/package.json", '{ "scripts": { "dev": "vite" } }');
  fx.write("pkg/pnpm-lock.yaml");
  fx.write("pkg/a.ts");
  activeFile("pkg/a.ts");
  __setPickHandler(async (items) => (items as unknown[])[0]);
  await run("runNearestScript", fx.dir);
  assert.deepEqual(__terminals()[0].sentTexts, ["pnpm run dev"]);
});

test("without an active editor the search starts at the folder argument", async () => {
  fx.write("package.json", '{ "scripts": { "go": "x" } }');
  __setPickHandler(async (items) => (items as unknown[])[0]);
  await run("runNearestScript", fx.dir);
  assert.deepEqual(__terminals()[0].sentTexts, ["npm run go"]);
});

test("dismissing the script picker starts no terminal", async () => {
  fx.write("package.json", '{ "scripts": { "go": "x" } }');
  await run("runNearestScript", fx.dir);
  assert.deepEqual(__terminals(), []);
});

test("no package.json, no scripts or unreadable scripts warn that none were found", async () => {
  await run("runNearestScript", fx.dir);
  fx.write("package.json", '{ "name": "x" }');
  await run("runNearestScript", fx.dir);
  fx.write("package.json", "{ broken");
  await run("runNearestScript", fx.dir);
  assert.deepEqual(__warningMessages(), [l10n("recipe.script.none"), l10n("recipe.script.none"), l10n("recipe.script.none")]);
  assert.deepEqual(__terminals(), []);
});

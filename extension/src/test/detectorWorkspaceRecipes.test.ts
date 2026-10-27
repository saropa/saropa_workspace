// Tests for the workspace-action recipes: entry point, canonical docs, .env setup, config opener,
// the boot macro, localhost, copy version and the nearest package script. Each decision (what is
// offered, in what order, with what action) is checked against a real temporary folder.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushWorkspaceRecipes } from "../recipes/detectorWorkspaceRecipes";
import type { RecipeResult } from "../recipes/detectors";
import { createFsFixture, type FsFixture } from "./fsFixture";

let fx: FsFixture;

beforeEach(() => {
  fx = createFsFixture("sw-wsrecipes-");
});
afterEach(() => fx.remove());

async function recipes(pkg?: Record<string, unknown>): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  await pushWorkspaceRecipes(fx.folder, pkg, out);
  return out;
}
const ids = (list: RecipeResult[]): string[] => list.map((r) => r.recipeId);
const byId = (list: RecipeResult[], id: string): RecipeResult => {
  const hit = list.find((r) => r.recipeId === id);
  assert.ok(hit, `${id} was offered`);
  return hit;
};

test("an empty folder offers only the open-all-config action", async () => {
  const list = await recipes();
  assert.deepEqual(ids(list), ["config.open"]);
  assert.deepEqual(list[0].action, { kind: "command", commandId: "saropaWorkspace.recipe.openConfigFiles", commandArgs: [fx.dir] });
});

test("the entry point is the package main when that file exists, as a file shortcut", async () => {
  fx.write("dist/app.js");
  const list = await recipes({ main: "dist/app.js" });
  assert.equal(byId(list, "entry").filePath, "dist/app.js");
  assert.equal(byId(list, "entry").action, undefined);
});

test("a declared main that is missing falls back to a conventional entry path", async () => {
  fx.write("src/index.ts");
  assert.equal(byId(await recipes({ main: "dist/app.js" }), "entry").filePath, "src/index.ts");
});

test("each canonical doc is offered only when its file exists, using the name found", async () => {
  fx.write("readme.md");
  fx.write("LICENSE.txt");
  const list = await recipes();
  assert.equal(byId(list, "doc.readme").filePath, "readme.md");
  assert.equal(byId(list, "doc.license").filePath, "LICENSE.txt");
  assert.deepEqual(ids(list).filter((id) => id.startsWith("doc.")), ["doc.readme", "doc.license"]);
});

test("the env setup is offered only when .env.example exists and .env does not", async () => {
  fx.write(".env.example", "A=1\n");
  const offered = byId(await recipes(), "env.setup");
  assert.deepEqual(offered.action, { kind: "command", commandId: "saropaWorkspace.recipe.setupEnv", commandArgs: [fx.dir] });
  fx.write(".env", "A=1\n");
  assert.equal(ids(await recipes()).includes("env.setup"), false);
});

test("without .env.example there is no env setup", async () => {
  assert.equal(ids(await recipes()).includes("env.setup"), false);
});

test("the boot macro opens the README, starts the dev command and opens localhost", async () => {
  fx.write("README.md");
  fx.write(".env", "PORT=8080\n");
  const boot = byId(await recipes({ scripts: { dev: "vite" } }), "boot");
  assert.deepEqual(boot.action, {
    kind: "macro",
    steps: [
      { kind: "open", path: `${fx.dir}/README.md` },
      { kind: "shell", shellCommand: "npm run dev", cwd: fx.dir },
      { kind: "url", url: "http://localhost:8080" },
    ],
  });
});

test("the boot macro has no localhost step when no port is known", async () => {
  fx.write("README.md");
  fx.write("manage.py");
  const boot = byId(await recipes(), "boot");
  assert.deepEqual(boot.action?.steps?.map((s) => s.kind), ["open", "shell"]);
  assert.equal(boot.action?.steps?.[1].shellCommand, "python manage.py runserver");
});

test("no boot macro without a README or without a dev command", async () => {
  assert.equal(ids(await recipes({ scripts: { dev: "vite" } })).includes("boot"), false);
  fx.write("README.md");
  assert.equal(ids(await recipes()).includes("boot"), false);
});

test("localhost uses the port found in .env, then vite config, then compose, then 3000 for a dev script", async () => {
  const port = async (pkg?: Record<string, unknown>): Promise<string | undefined> =>
    (await recipes(pkg)).find((r) => r.recipeId === "localhost")?.action?.url;
  assert.equal(await port(), undefined);
  assert.equal(await port({ scripts: { start: "node ." } }), "http://localhost:3000");
  fx.write("docker-compose.yml", "services:\n  web:\n    ports:\n      - \"9090:80\"\n");
  assert.equal(await port({ scripts: { start: "node ." } }), "http://localhost:9090");
  fx.write("vite.config.ts", "export default { server: { port: 5173 } }\n");
  assert.equal(await port(), "http://localhost:5173");
  fx.write(".env", "PORT=4000\n");
  const list = await recipes();
  assert.equal(byId(list, "localhost").label, "Open localhost:4000");
});

test("copy version is offered with a version in package.json or a manifest file", async () => {
  assert.equal(ids(await recipes({ name: "x" })).includes("copy.version"), false);
  assert.deepEqual(byId(await recipes({ version: "1.2.3" }), "copy.version").action, {
    kind: "command", commandId: "saropaWorkspace.recipe.copyVersion", commandArgs: [fx.dir],
  });
  fx.write("Cargo.toml");
  assert.ok(ids(await recipes()).includes("copy.version"));
});

test("the package script runner is offered only when package.json has a scripts object", async () => {
  assert.equal(ids(await recipes({ name: "x" })).includes("nearest.script"), false);
  assert.equal(ids(await recipes({ scripts: "no" })).includes("nearest.script"), false);
  assert.deepEqual(byId(await recipes({ scripts: {} }), "nearest.script").action, {
    kind: "command", commandId: "saropaWorkspace.recipe.runNearestScript", commandArgs: [fx.dir],
  });
});

test("recipes come out in catalog order", async () => {
  fx.write("src/main.ts");
  fx.write("README.md");
  fx.write(".env.example");
  const list = await recipes({ version: "1.0.0", scripts: { dev: "vite" } });
  assert.deepEqual(ids(list), ["entry", "doc.readme", "env.setup", "config.open", "boot", "localhost", "copy.version", "nearest.script"]);
});

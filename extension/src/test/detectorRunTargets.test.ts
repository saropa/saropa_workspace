// Unit tests for the run-target recipe block (dev / test / lint / build / install /
// typecheck / compose / migrate / format / clean / upgrade). pushRunTargets reads a
// folder's manifests/lockfiles through the stub's workspace.fs (real node fs against
// a temp dir) and pushes the derived recipes onto an out array. The REAL derivation
// runs — the per-ecosystem branches, the package-manager pick, and the shell-action
// shape — so the assertions check which targets seed for a given project and that
// each carries a folder-scoped shell command. The vscode types are stripped at
// bundle time; only the fs slice is faked.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { pushRunTargets } from "../recipes/detectorRunTargets";
import type { RecipeResult } from "../recipes/detectors";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-runtargets-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

const write = (rel: string, body = ""): void => {
  const full = nodePath.join(tmpDir, rel);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, body);
};

// Collect the recipes pushRunTargets emits for a given package.json object.
async function run(pkg?: Record<string, unknown>): Promise<RecipeResult[]> {
  const out: RecipeResult[] = [];
  await pushRunTargets(asFolder(folder), pkg, out);
  return out;
}

const byId = (out: RecipeResult[]): Map<string, RecipeResult> =>
  new Map(out.map((r) => [r.recipeId, r]));

test("a Node project seeds the script-driven targets with the detected package manager", async () => {
  // yarn.lock makes packageManager resolve to yarn; the scripts drive dev/test/build.
  write("yarn.lock");
  const out = byId(
    await run({ scripts: { dev: "vite", test: "jest", build: "tsup" } })
  );
  assert.equal(out.get("test")?.action?.shellCommand, "yarn test");
  assert.equal(out.get("build")?.action?.shellCommand, "yarn run build");
  // install is always available for a Node project (the manifest is present).
  assert.equal(out.get("install")?.action?.shellCommand, "yarn install");
});

test("each emitted run target is a folder-scoped shell action", async () => {
  const out = await run({ scripts: { test: "jest" } });
  const test = out.find((r) => r.recipeId === "test");
  assert.ok(test);
  // shell recipes run in the folder so the command lands in the right cwd.
  assert.equal(test!.action?.kind, "shell");
  assert.equal(test!.action?.cwd, folder.uri.fsPath);
});

test("a Dart (non-Flutter) project uses dart test and dart analyze", async () => {
  write("pubspec.yaml", "name: pkg\n");
  const out = byId(await run(undefined));
  assert.equal(out.get("test")?.action?.shellCommand, "dart test");
  // No flutter: key -> the bare-Dart linter, not flutter analyze.
  assert.equal(out.get("lint")?.action?.shellCommand, "dart analyze");
  assert.equal(out.get("install")?.action?.shellCommand, "dart pub get");
});

test("a Flutter project uses the flutter toolchain (analyze, clean, build)", async () => {
  write("pubspec.yaml", "name: app\nflutter:\n  sdk: flutter\n");
  const out = byId(await run(undefined));
  assert.equal(out.get("lint")?.action?.shellCommand, "flutter analyze");
  assert.equal(out.get("build")?.action?.shellCommand, "flutter build");
  // clean is only offered for tools with a known single clean command — flutter is one.
  assert.equal(out.get("clean")?.action?.shellCommand, "flutter clean");
});

test("a Rust project seeds cargo targets including format and clean", async () => {
  write("Cargo.toml", 'name = "x"\n');
  const out = byId(await run(undefined));
  assert.equal(out.get("test")?.action?.shellCommand, "cargo test");
  assert.equal(out.get("lint")?.action?.shellCommand, "cargo clippy");
  assert.equal(out.get("build")?.action?.shellCommand, "cargo build");
  assert.equal(out.get("format")?.action?.shellCommand, "cargo fmt");
  assert.equal(out.get("clean")?.action?.shellCommand, "cargo clean");
  assert.equal(out.get("upgrade")?.action?.shellCommand, "cargo update");
});

test("a tsconfig.json seeds the TypeScript type-check target", async () => {
  write("tsconfig.json", "{}");
  const out = byId(await run({}));
  assert.equal(out.get("typecheck")?.action?.shellCommand, "npm exec tsc --noEmit");
});

test("a docker-compose file seeds the compose-up target", async () => {
  write("docker-compose.yml", "services: {}");
  const out = byId(await run(undefined));
  assert.equal(out.get("compose.up")?.action?.shellCommand, "docker compose up");
});

test("an empty folder seeds no run targets at all", async () => {
  // No manifest, no markers: every branch falls through, so the out array stays empty
  // rather than inventing commands that would fail.
  assert.deepEqual(await run(undefined), []);
});

test("clean for npm is gated on an explicit scripts.clean (no universal npm clean)", async () => {
  // There is no conventional npm clean, so it must NOT seed without the script.
  write("package-lock.json");
  const withoutScript = byId(await run({ scripts: { build: "tsup" } }));
  assert.equal(withoutScript.get("clean"), undefined);

  const withScript = byId(await run({ scripts: { clean: "rimraf dist" } }));
  assert.equal(withScript.get("clean")?.action?.shellCommand, "npm run clean");
});

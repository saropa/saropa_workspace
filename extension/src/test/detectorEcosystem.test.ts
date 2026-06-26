// Unit tests for the ecosystem probes — the reusable detectors that read a folder's
// manifests/config files and derive a command or fact (dev command, migrate command,
// entry file, dev port, lint/format presence, version source). They read through the
// stub's workspace.fs (real node fs against a temp dir), so the REAL probe logic runs
// — the precedence ordering, the marker-file branches, and the undefined fall-through
// — not a reimplementation. The vscode types are stripped at bundle time; only the
// small fs slice is faked.

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
import {
  detectDevCommand,
  detectMigrate,
  detectEntryPoint,
  detectPort,
  hasEslint,
  hasPrettier,
  hasVersionSource,
} from "../recipes/detectorEcosystem";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-ecosystem-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// Write a file (creating parent dirs) so a probe that stats/reads it sees real data.
const write = (rel: string, body = ""): void => {
  const full = nodePath.join(tmpDir, rel);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, body);
};

// --- detectDevCommand --------------------------------------------------

test("detectDevCommand prefers a package script dev over start, with the lockfile's pm", async () => {
  // pnpm-lock.yaml makes packageManager resolve to pnpm; scripts.dev wins over start.
  write("pnpm-lock.yaml");
  const pkg = { scripts: { dev: "vite", start: "node ." } };
  assert.equal(await detectDevCommand(asFolder(folder), pkg), "pnpm run dev");
});

test("detectDevCommand falls back to start when there is no dev script", async () => {
  // No lockfile -> npm; start is the only declared script.
  assert.equal(
    await detectDevCommand(asFolder(folder), { scripts: { start: "node ." } }),
    "npm start"
  );
});

test("detectDevCommand recognizes a Django manage.py over the framework fallback", async () => {
  write("manage.py");
  assert.equal(
    await detectDevCommand(asFolder(folder), undefined),
    "python manage.py runserver"
  );
});

test("detectDevCommand recognizes a Flutter pubspec by its flutter: key", async () => {
  // The pubspec must carry a flutter: section — a bare Dart pubspec is not a runnable
  // app, so it returns undefined rather than inventing flutter run.
  write("pubspec.yaml", "name: app\nflutter:\n  sdk: flutter\n");
  assert.equal(await detectDevCommand(asFolder(folder), undefined), "flutter run");
});

test("detectDevCommand returns undefined when nothing matches", async () => {
  assert.equal(await detectDevCommand(asFolder(folder), undefined), undefined);
});

// --- detectMigrate -----------------------------------------------------

test("detectMigrate recognizes Prisma from its schema file", async () => {
  write("prisma/schema.prisma");
  assert.equal(
    await detectMigrate(asFolder(folder), undefined),
    "npm exec prisma migrate dev"
  );
});

test("detectMigrate recognizes Alembic from alembic.ini or the migrations env", async () => {
  write("alembic.ini");
  assert.equal(await detectMigrate(asFolder(folder), undefined), "alembic upgrade head");
});

test("detectMigrate recognizes Drizzle from the dependency manifest, not a file", async () => {
  // Drizzle has no fixed config path, so it is detected by a dependency match.
  const pkg = { dependencies: { "drizzle-orm": "^0.30.0" } };
  assert.equal(
    await detectMigrate(asFolder(folder), pkg),
    "npm exec drizzle-kit migrate"
  );
});

test("detectMigrate returns undefined when no migration tool is present", async () => {
  assert.equal(await detectMigrate(asFolder(folder), { dependencies: {} }), undefined);
});

// --- detectEntryPoint --------------------------------------------------

test("detectEntryPoint prefers package.json main when it exists on disk", async () => {
  write("dist/app.js");
  const entry = await detectEntryPoint(asFolder(folder), { main: "dist/app.js" });
  assert.equal(entry, "dist/app.js");
});

test("detectEntryPoint skips a stale main and falls to a real conventional path", async () => {
  // main points at a missing file; the first conventional candidate that EXISTS wins,
  // so the recipe never opens a dead path.
  write("src/main.ts");
  const entry = await detectEntryPoint(asFolder(folder), { main: "dist/missing.js" });
  assert.equal(entry, "src/main.ts");
});

test("detectEntryPoint returns undefined when no candidate exists", async () => {
  assert.equal(await detectEntryPoint(asFolder(folder), undefined), undefined);
});

// --- detectPort --------------------------------------------------------

test("detectPort reads an explicit PORT from .env first", async () => {
  write(".env", "FOO=bar\nPORT=8080\n");
  // .env is the most authoritative source, so it wins over a later vite/default port.
  assert.equal(await detectPort(asFolder(folder), undefined), 8080);
});

test("detectPort reads vite server.port when no .env PORT is set", async () => {
  write("vite.config.ts", "export default { server: { port: 5173 } };");
  assert.equal(await detectPort(asFolder(folder), undefined), 5173);
});

test("detectPort falls back to 3000 only when a web dev/start script exists", async () => {
  // No declared port anywhere, but a web dev script implies the conventional port.
  assert.equal(await detectPort(asFolder(folder), { scripts: { dev: "vite" } }), 3000);
  // Without a web script there is no project to serve, so no port is inferred.
  assert.equal(await detectPort(asFolder(folder), undefined), undefined);
});

// --- hasEslint / hasPrettier -------------------------------------------

test("hasEslint is true for an inline package.json config or a config file", async () => {
  assert.equal(await hasEslint(asFolder(folder), { eslintConfig: {} }), true);
  write("eslint.config.js");
  assert.equal(await hasEslint(asFolder(folder), undefined), true);
});

test("hasEslint is false with no inline key and no config file", async () => {
  assert.equal(await hasEslint(asFolder(folder), {}), false);
});

test("hasPrettier is true for an inline package.json config or a config file", async () => {
  assert.equal(await hasPrettier(asFolder(folder), { prettier: {} }), true);
  write(".prettierrc.json");
  assert.equal(await hasPrettier(asFolder(folder), undefined), true);
});

test("hasPrettier is false with no inline key and no config file", async () => {
  // A fresh temp dir per test (beforeEach), so no prettier config from another case
  // leaks in — this asserts the genuine empty-project result.
  assert.equal(await hasPrettier(asFolder(folder), {}), false);
});

// --- hasVersionSource --------------------------------------------------

test("hasVersionSource is true from a package.json version field", async () => {
  assert.equal(await hasVersionSource(asFolder(folder), { version: "1.2.3" }), true);
});

test("hasVersionSource is true from a parseable manifest even with no package.json", async () => {
  write("Cargo.toml", 'name = "x"\nversion = "0.1.0"\n');
  assert.equal(await hasVersionSource(asFolder(folder), undefined), true);
});

test("hasVersionSource is false with no version field and no manifest", async () => {
  // A package.json present but carrying no version still yields false — there is
  // nothing for the copy command to produce.
  assert.equal(await hasVersionSource(asFolder(folder), { name: "x" }), false);
});

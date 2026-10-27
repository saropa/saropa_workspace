// Rule loading for the Release Board host: layering the user's rules, naming projects after
// folders, the board-on gate, and the whole load against a real temp folder.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { BoardConfig } from "../../board/types";
import { DEFAULT_ROOTS, RULES_FILE, boardReady, layerUserRules, loadConfig, uniqueProjectId } from "../../commands/boardConfigLoad";

const stub = vscode as unknown as {
  __setConfig(section: string, key: string, value: unknown): void;
  __resetConfig(): void;
  __setWorkspaceFolders(f: Array<{ uri: vscode.Uri; name: string; index: number }> | undefined): void;
};

afterEach(() => {
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

function shipped(): BoardConfig {
  return { version: 1, ignore: ["node_modules/**"], ruleSets: { a: { description: "shipped a" }, b: {} }, projects: [] };
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "board-cfg-"));
}

function open(dir: string, name = "app"): void {
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name, index: 0 }]);
}

test("a user file may leave out sections: shipped ignore and rule sets stay", () => {
  const cfg = layerUserRules(shipped(), { version: 1 } as Partial<BoardConfig>);
  assert.deepEqual(cfg.ignore, ["node_modules/**"]);
  assert.deepEqual(Object.keys(cfg.ruleSets), ["a", "b"]);
  assert.deepEqual(cfg.projects, []);
});

test("user rule sets are layered over the shipped ones by name", () => {
  const cfg = layerUserRules(shipped(), { ignore: ["x/**"], ruleSets: { a: { description: "mine" }, c: {} } });
  assert.deepEqual(cfg.ignore, ["x/**"]);
  assert.equal(cfg.ruleSets.a.description, "mine");
  assert.deepEqual(Object.keys(cfg.ruleSets).sort(), ["a", "b", "c"]);
});

test("two folders with one name get distinct project ids", () => {
  const used = new Set<string>();
  assert.equal(uniqueProjectId("app", used), "app");
  assert.equal(uniqueProjectId("app", used), "app-2");
  assert.equal(uniqueProjectId("app", used), "app-3");
  assert.equal(uniqueProjectId("lib", used), "lib");
});

test("the board is not ready with no folder open or with the setting off", () => {
  assert.equal(boardReady(true), false);
  open(os.tmpdir());
  assert.equal(boardReady(true), true);
  stub.__setConfig("saropaWorkspace.releaseBoard", "enabled", false);
  assert.equal(boardReady(true), false);
});

test("with no projects listed every folder becomes one, with only the document folders it has", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "bugs"));
  fs.mkdirSync(path.join(dir, "plans"));
  open(dir, "app");
  const cfg = await loadConfig();
  assert.equal(cfg.projects.length, 1);
  assert.equal(cfg.projects[0].id, "app");
  assert.equal(cfg.projects[0].path, dir);
  assert.deepEqual(cfg.projects[0].roots, DEFAULT_ROOTS.filter((r) => r === "bugs" || r === "plans"));
});

test("the user's rules file replaces the project list and a profile setting wins over it", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".saropa"));
  fs.writeFileSync(
    path.join(dir, RULES_FILE),
    JSON.stringify({ version: 1, profile: "zero", projects: [{ id: "web", path: "web", roots: ["docs"], ruleSets: [] }] })
  );
  open(dir);
  let cfg = await loadConfig();
  assert.equal(cfg.profile, "zero");
  assert.equal(cfg.projects[0].id, "web");
  assert.equal(cfg.projects[0].path, dir + "/web");
  stub.__setConfig("saropaWorkspace.releaseBoard", "profile", "deliberate");
  cfg = await loadConfig();
  assert.equal(cfg.profile, "deliberate");
});

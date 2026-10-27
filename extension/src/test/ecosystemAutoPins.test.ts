// Unit tests for the one-time ecosystem auto-pin pattern seeding. Runs the real
// marker detection against a temp project folder.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { seedEcosystemAutoPins } from "../activation/ecosystemAutoPins";
import { fakeContext } from "./_stub/context";
import type { ShortcutStore } from "../model/shortcutStore";

type StubVscode = typeof vscode & {
  __setWorkspaceFolders(f: vscode.WorkspaceFolder[] | undefined): void;
  __setConfig(section: string, key: string, value: unknown): void;
  __getConfig(section: string, key: string): unknown;
  __resetConfig(): void;
};
const stub = vscode as StubVscode;

function project(files: Record<string, string>): vscode.WorkspaceFolder {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eco-"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return { uri: vscode.Uri.file(dir), name: "proj", index: 0 };
}

function fakeStore(explicit: boolean): ShortcutStore {
  return { hasExplicitProjectShortcuts: () => explicit } as unknown as ShortcutStore;
}

function patterns(): string[] {
  return stub.__getConfig("saropaWorkspace", "autoPins.patterns") as string[];
}

beforeEach(() => {
  stub.__resetConfig();
  stub.__setWorkspaceFolders(undefined);
});

test("a Flutter project gets .env plus the pubspec and analysis patterns", async () => {
  const folder = project({ "pubspec.yaml": "name: x\nflutter:\n  uses-material-design: true\n" });
  stub.__setWorkspaceFolders([folder]);
  await seedEcosystemAutoPins(fakeContext(), fakeStore(false));
  assert.deepEqual(patterns(), [".env", "pubspec.yaml", "analysis_options.yaml"]);
});

test("existing patterns are kept and not duplicated", async () => {
  const folder = project({ "Cargo.toml": "[package]" });
  stub.__setWorkspaceFolders([folder]);
  stub.__setConfig("saropaWorkspace", "autoPins.patterns", ["README.md", ".env"]);
  await seedEcosystemAutoPins(fakeContext(), fakeStore(false));
  assert.deepEqual(patterns(), ["README.md", ".env", "Cargo.toml"]);
});

test("Django, Go and Rust markers each add their own files", async () => {
  const folder = project({ "manage.py": "", "go.mod": "module x", "Cargo.toml": "" });
  stub.__setWorkspaceFolders([folder]);
  await seedEcosystemAutoPins(fakeContext(), fakeStore(false));
  assert.deepEqual(patterns(), [".env", "manage.py", "requirements.txt", "Cargo.toml", "go.mod"]);
});

test("a project that already has explicit shortcuts is left alone", async () => {
  const folder = project({ "go.mod": "module x" });
  stub.__setWorkspaceFolders([folder]);
  await seedEcosystemAutoPins(fakeContext(), fakeStore(true));
  assert.equal(patterns(), undefined);
});

test("seeding runs once per folder per workspace", async () => {
  const folder = project({ "go.mod": "module x" });
  stub.__setWorkspaceFolders([folder]);
  const ctx = fakeContext();
  await seedEcosystemAutoPins(ctx, fakeStore(false));
  stub.__setConfig("saropaWorkspace", "autoPins.patterns", ["custom"]);
  await seedEcosystemAutoPins(ctx, fakeStore(false));
  assert.deepEqual(patterns(), ["custom"]);
});

test("nothing is written and the latch is set when every pattern is already configured", async () => {
  const folder = project({});
  stub.__setWorkspaceFolders([folder]);
  stub.__setConfig("saropaWorkspace", "autoPins.patterns", [".env"]);
  const ctx = fakeContext();
  await seedEcosystemAutoPins(ctx, fakeStore(false));
  assert.deepEqual(patterns(), [".env"]);
  // An empty result is still a result: the latch is set so detection is not repeated.
  assert.equal(ctx.workspaceState.keys().length, 1);
});

test("with no workspace folders it does nothing", async () => {
  await seedEcosystemAutoPins(fakeContext(), fakeStore(false));
  assert.equal(patterns(), undefined);
});

test("a failing folder is logged and does not abort the run", async () => {
  const folder = project({ "go.mod": "x" });
  stub.__setWorkspaceFolders([folder]);
  const throwing = {
    hasExplicitProjectShortcuts: () => {
      throw new Error("boom");
    },
  } as unknown as ShortcutStore;
  const original = console.error;
  const logged: string[] = [];
  console.error = (m: unknown): void => void logged.push(String(m));
  try {
    await seedEcosystemAutoPins(fakeContext(), throwing);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /ecosystemAutoPins failed for proj: boom/);
});

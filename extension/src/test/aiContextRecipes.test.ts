// Unit tests for the AI-context recipe detector. detectAiContextRecipes scans the
// configured chat folders for transcript files and surfaces the freshest as pins.
// The directory listing goes through workspace.fs.readDirectory, which the vscode
// stub does NOT model; the call sits inside a try/catch, so an unmodeled API throws
// and is swallowed exactly like an absent folder — meaning the detector reads the
// chat store as "empty" here. That still lets two real, observable behaviors be
// verified deterministically: the settings gate that disables the feature, and the
// graceful-absence result when no configured chat folder is present. The richer
// transcript parsing needs a real readDirectory and is covered by the host harness,
// not this Node-runner file.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { detectAiContextRecipes } from "../recipes/aiContextRecipes";
import type { WorkspaceFolder as VscodeFolder } from "vscode";

const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-aictx-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("the feature is gated off — disabling it returns no recipes", async () => {
  // aiContext.enabled=false short-circuits before any folder scan, so the detector
  // produces nothing regardless of what is on disk. This is the explicit opt-out path.
  __setConfig("saropaWorkspace", "aiContext.enabled", false);
  const out = await detectAiContextRecipes(asFolder(folder));
  assert.deepEqual(out, []);
});

test("no configured chat folder present yields nothing (graceful absence)", async () => {
  // With the feature enabled (its default) but no chat folder readable, the detector
  // must produce an empty list and never throw on the folders it probes — the same
  // "no AI chats here" result a non-AI project gets. (The folder listing is swallowed
  // by the detector's own try/catch, so an unreadable store reads as absent.)
  __setConfig("saropaWorkspace", "aiContext.enabled", true);
  const out = await detectAiContextRecipes(asFolder(folder));
  assert.deepEqual(out, [], "an absent chat store seeds no recipes");
});

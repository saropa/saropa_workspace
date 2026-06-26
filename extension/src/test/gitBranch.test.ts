// Branch-linked pins (WOW #3). Two units run here against the fs-backed vscode stub
// (see pinStore.test for the harness rationale): readCurrentBranch's HEAD parsing
// (the single source the tree's branch filter and time-bomb expiry both read), and
// the store's setPinBranch persistence round-trip. Both touch only workspace.fs and
// the project file, which the stub backs with a real temp directory, so the REAL
// code runs — not a reimplementation.

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
import { fakeContext } from "./_stub/context";
import { readCurrentBranch } from "../exec/gitBranch";
import { PinStore } from "../model/pinStore";
import type { WorkspaceFolder as VscodeFolder, Uri as VscodeUri } from "vscode";

// The store/reader type their args as the real vscode shapes; the stub models only
// the slice they read. Cast at the call site so tsc accepts the faithful stub value.
const asFolder = (f: WorkspaceFolder): VscodeFolder => f as unknown as VscodeFolder;
const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

// Write a .git/HEAD with the given contents, creating the .git directory first, so
// readCurrentBranch's stat(.git)=directory -> read(.git/HEAD) path runs.
function writeHead(contents: string): void {
  nodeFs.mkdirSync(nodePath.join(tmpDir, ".git"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(tmpDir, ".git", "HEAD"), contents);
}

beforeEach(() => {
  __resetConfig();
  // Skip recipe detection so a store refresh exercises only store IO.
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs
    .mkdtempSync(nodePath.join(os.tmpdir(), "sw-branch-"))
    .replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("readCurrentBranch returns the branch name from a symbolic-ref HEAD", async () => {
  // A normal checkout: HEAD points at refs/heads/<branch>. A slash in the name
  // (feature/auth) must survive — the capture is greedy to the line end.
  writeHead("ref: refs/heads/feature/auth\n");
  assert.equal(await readCurrentBranch(asFolder(folder)), "feature/auth");
});

test("readCurrentBranch returns the raw commit hash for a detached HEAD", async () => {
  // Detached HEAD stores the bare commit hash; the reader returns it verbatim so a
  // checkout of a different commit still reads as a branch change.
  const hash = "0123456789abcdef0123456789abcdef01234567";
  writeHead(hash + "\n");
  assert.equal(await readCurrentBranch(asFolder(folder)), hash);
});

test("readCurrentBranch returns undefined when there is no repository", async () => {
  // No .git at all: the reader fails closed to undefined, which every consumer
  // treats as "show the pin / do not remove it" — never losing a pin on a read miss.
  assert.equal(await readCurrentBranch(asFolder(folder)), undefined);
});

test("setPinBranch links a stored pin to a branch and round-trips across instances", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "src/app.ts");
  assert.equal(await store.addPin(asUri(target), "project"), true);
  const pin = store.getProjectPins().find((p) => p.path === "src/app.ts");
  assert.ok(pin, "pin should be added");

  await store.setPinBranch(pin!, "feature/auth");
  assert.equal(
    store.getProjectPins().find((p) => p.path === "src/app.ts")?.branch,
    "feature/auth"
  );

  // A fresh store reading the same folder must see the branch link — proving it
  // persisted to the project file, not just the in-memory cache.
  const reopened = new PinStore(fakeContext());
  await reopened.init();
  assert.equal(
    reopened.getProjectPins().find((p) => p.path === "src/app.ts")?.branch,
    "feature/auth",
    "branch link should load from disk"
  );
});

test("setPinBranch with undefined clears the link (pin shows on all branches)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const target = Uri.joinPath(folder.uri, "README.md");
  await store.addPin(asUri(target), "project");
  const pin = store.getProjectPins().find((p) => p.path === "README.md");
  assert.ok(pin);

  await store.setPinBranch(pin!, "main");
  await store.setPinBranch(
    store.getProjectPins().find((p) => p.path === "README.md")!,
    undefined
  );
  assert.equal(
    store.getProjectPins().find((p) => p.path === "README.md")?.branch,
    undefined,
    "cleared branch should be absent, not an empty string"
  );
});

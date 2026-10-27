// Tests for the .env context switcher: which files count as profiles, how the active
// one is detected, and the backup rule for a hand-edited .env.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri,
  __setWorkspaceFolders,
  __setPickHandler,
  __setWarningAnswer,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
  __resetHandlers,
  type WorkspaceFolder,
} from "./_stub/vscode";
import { switchEnvProfile } from "../commands/envProfiles";

let dir: string;
let other: string | undefined;
const file = (name: string, root = dir): string => nodePath.join(root, name);
const read = (name: string, root = dir): string => nodeFs.readFileSync(file(name, root), "utf8");
const write = (name: string, text: string, root = dir): void => nodeFs.writeFileSync(file(name, root), text);

function folder(root: string, name: string, index: number): WorkspaceFolder {
  return { uri: Uri.file(root), name, index };
}

// A pick handler that records the item lists it was shown and chooses by label.
function chooseLabel(label: string | undefined, shown: unknown[][] = []): void {
  __setPickHandler(async (items) => {
    shown.push([...items]);
    return label === undefined ? undefined : items.find((i) => (i as { label: string }).label === label);
  });
}

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-env-"));
  other = undefined;
  __setWorkspaceFolders([folder(dir, "proj", 0)]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
  if (other) {
    nodeFs.rmSync(other, { recursive: true, force: true });
  }
});

test("with no folder open it warns and offers nothing", async () => {
  __setWorkspaceFolders(undefined);
  await switchEnvProfile();
  assert.deepEqual(__warningMessages(), ["Open a workspace folder to switch .env profiles."]);
});

test("templates, the backup, the bare .env and folders are not profiles", async () => {
  for (const n of [".env", ".env.example", ".env.SAMPLE", ".env.template", ".env.dist", ".env.bak", ".env.backup"]) {
    write(n, "x");
  }
  nodeFs.mkdirSync(file(".env.dir"));
  await switchEnvProfile();
  assert.deepEqual(__infoMessages(), [
    "No .env profiles found. Create .env.staging, .env.prod, etc. to switch between them.",
  ]);
});

test("profiles are listed by name with the matching one marked active", async () => {
  write(".env.prod", "A=1");
  write(".env.dev", "A=0");
  write(".env.local", "A=2");
  write(".env", "A=1");
  const shown: unknown[][] = [];
  chooseLabel(undefined, shown);
  await switchEnvProfile();
  const items = shown[0] as Array<{ label: string; description: string }>;
  assert.deepEqual(
    items.map((i) => [i.label, i.description]),
    [["dev", ""], ["local", ""], ["prod", "active now"]]
  );
  assert.equal(read(".env"), "A=1");
});

test("switching from a recognized profile overwrites .env with no confirmation and no backup", async () => {
  write(".env.prod", "A=1");
  write(".env.staging", "A=3");
  write(".env", "A=1");
  chooseLabel("staging");
  await switchEnvProfile();
  assert.equal(read(".env"), "A=3");
  assert.equal(nodeFs.existsSync(file(".env.bak")), false);
  assert.deepEqual(__warningMessages(), []);
  assert.deepEqual(__infoMessages(), ["Switched .env to staging. Restart your dev server to apply the new environment."]);
});

test("choosing the already-active profile only says so", async () => {
  write(".env.prod", "A=1");
  write(".env", "A=1");
  chooseLabel("prod");
  await switchEnvProfile();
  assert.deepEqual(__infoMessages(), ["prod is already the active .env."]);
});

test("a missing .env is created from the chosen profile without a confirmation", async () => {
  write(".env.prod", "A=1");
  chooseLabel("prod");
  await switchEnvProfile();
  assert.equal(read(".env"), "A=1");
  assert.deepEqual(__warningMessages(), []);
});

test("a hand-edited .env is backed up to .env.bak after the user agrees", async () => {
  write(".env.prod", "A=1");
  write(".env", "HAND=edited");
  chooseLabel("prod");
  __setWarningAnswer((_m, items) => items[0]);
  await switchEnvProfile();
  assert.deepEqual(__warningMessages(), [
    "Your current .env has changes that match no profile. Back it up to .env.bak and switch to prod?",
  ]);
  assert.equal(read(".env.bak"), "HAND=edited");
  assert.equal(read(".env"), "A=1");
});

test("declining the backup leaves .env as it was and writes nothing", async () => {
  write(".env.prod", "A=1");
  write(".env", "HAND=edited");
  chooseLabel("prod");
  await switchEnvProfile();
  assert.equal(read(".env"), "HAND=edited");
  assert.equal(nodeFs.existsSync(file(".env.bak")), false);
  assert.deepEqual(__infoMessages(), []);
});

test("dismissing the profile pick changes nothing", async () => {
  write(".env.prod", "A=1");
  write(".env", "HAND=edited");
  chooseLabel(undefined);
  await switchEnvProfile();
  assert.equal(read(".env"), "HAND=edited");
  assert.deepEqual(__warningMessages(), []);
});

test("a profile deleted between the list and the pick is reported by file name", async () => {
  write(".env.prod", "A=1");
  write(".env.dev", "A=0");
  write(".env", "A=0");
  __setPickHandler(async (items) => {
    nodeFs.rmSync(file(".env.prod"));
    return items.find((i) => (i as { label: string }).label === "prod");
  });
  await switchEnvProfile();
  assert.deepEqual(__warningMessages(), [".env.prod no longer exists."]);
  assert.equal(read(".env"), "A=0");
});

test("with several folders only those holding profiles are offered, with their counts", async () => {
  other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-env2-"));
  const empty = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-env3-"));
  try {
    write(".env.prod", "A=1");
    write(".env.dev", "A=0");
    write(".env.qa", "Z=1", other);
    __setWorkspaceFolders([folder(dir, "one", 0), folder(other, "two", 1), folder(empty, "three", 2)]);
    const shown: unknown[][] = [];
    chooseLabel(undefined, shown);
    await switchEnvProfile();
    const items = shown[0] as Array<{ label: string; description: string }>;
    assert.deepEqual(items.map((i) => [i.label, i.description]), [["one", "2 profile(s)"], ["two", "1 profile(s)"]]);
    assert.equal(shown.length, 1, "dismissing the folder pick stops before the profile pick");
  } finally {
    nodeFs.rmSync(empty, { recursive: true, force: true });
  }
});

test("with several folders the chosen one is the one that is switched", async () => {
  other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-env2-"));
  write(".env.prod", "A=1");
  write(".env.qa", "Z=1", other);
  __setWorkspaceFolders([folder(dir, "one", 0), folder(other, "two", 1)]);
  let call = 0;
  __setPickHandler(async (items) => {
    call += 1;
    const label = call === 1 ? "two" : "qa";
    return items.find((i) => (i as { label: string }).label === label);
  });
  await switchEnvProfile();
  assert.equal(read(".env", other), "Z=1");
  assert.equal(nodeFs.existsSync(file(".env")), false);
});

test("an unreadable folder counts as having no profiles", async () => {
  __setWorkspaceFolders([folder(file("does-not-exist"), "gone", 0)]);
  await switchEnvProfile();
  assert.deepEqual(__infoMessages(), [
    "No .env profiles found. Create .env.staging, .env.prod, etc. to switch between them.",
  ]);
});

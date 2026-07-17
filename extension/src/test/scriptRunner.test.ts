// Tests for the library-script run pipeline: the tool-requirement pre-flight
// (missingRequirements) and runLibraryScript's blocking behavior when a required
// tool is absent from PATH. findOnPath does a real filesystem/PATH scan, so these
// tests rely on a command name that is certain to exist on the host (node itself,
// resolved via process.execPath's directory prepended to PATH) and one that is
// certain not to.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  __setWorkspaceFolders,
  __errorMessages,
  __resetErrorMessages,
  Uri,
} from "./_stub/vscode";
import { runLibraryScript, missingRequirements } from "../exec/scriptRunner";
import { LibraryScript } from "../model/scriptLibrary";

// A command guaranteed to resolve: this test process's own node executable,
// found by prepending its directory to PATH for the duration of each test.
const REAL_COMMAND = path.basename(process.execPath, path.extname(process.execPath));
const FAKE_COMMAND = "definitely-not-a-real-command-xyz";

const originalPath = process.env.PATH ?? process.env.Path;

beforeEach(() => {
  process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${originalPath ?? ""}`;
  __resetErrorMessages();
  __setWorkspaceFolders(undefined);
});

afterEach(() => {
  process.env.PATH = originalPath;
  __resetErrorMessages();
  __setWorkspaceFolders(undefined);
});

function scriptWithRequirements(
  requires: LibraryScript["requires"]
): LibraryScript {
  return {
    id: "test-script",
    label: "Test script",
    description: "",
    icon: "file",
    tags: [],
    entry: "test-script/__main__.py",
    requires,
    config: { command: "python" },
  };
}

test("missingRequirements returns a required tool absent from PATH", () => {
  const script = scriptWithRequirements([
    { type: "command", name: FAKE_COMMAND, reason: "does the thing" },
  ]);
  const missing = missingRequirements(script);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, FAKE_COMMAND);
});

test("missingRequirements omits a tool that resolves on PATH", () => {
  const script = scriptWithRequirements([
    { type: "command", name: REAL_COMMAND, reason: "runs the runtime" },
  ]);
  assert.deepEqual(missingRequirements(script), []);
});

test("missingRequirements does not block on a missing OPTIONAL tool", () => {
  const script = scriptWithRequirements([
    { type: "command", name: FAKE_COMMAND, reason: "nice to have", optional: true },
  ]);
  assert.deepEqual(missingRequirements(script), []);
});

test("runLibraryScript shows a named diagnostic and does not run when a required tool is missing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sr-"));
  try {
    const entryDir = path.join(tmp, "scripts", "library", "test-script");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "__main__.py"), "", "utf-8");
    __setWorkspaceFolders([
      { uri: Uri.file(tmp), name: "test", index: 0 },
    ]);

    const script = scriptWithRequirements([
      { type: "command", name: FAKE_COMMAND, reason: "does the thing" },
    ]);
    await runLibraryScript(script, tmp);

    const messages = __errorMessages();
    assert.equal(messages.length, 1);
    assert.match(messages[0], new RegExp(FAKE_COMMAND));
    assert.match(messages[0], /Test script/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Unit tests for the pure command-assembly core (commandPlan.ts). No VS Code, no
// filesystem — the IO (config + shebang reads) lives in runner.ts and feeds these
// functions, so the precedence and quoting are tested here in isolation (4.1).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveInterpreter,
  isRunnablePlan,
  quoteArg,
  assembleCommandLine,
} from "../exec/commandPlan";

const DEFAULTS = { ".py": "python", ".js": "node" };

test("resolveInterpreter: an explicit command wins over everything", () => {
  assert.equal(
    resolveInterpreter({
      explicitCommand: "pwsh -File",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: "python3",
      platform: "linux",
    }),
    "pwsh -File"
  );
});

test("resolveInterpreter: a blank command runs directly on Unix (shebang honored)", () => {
  // On Unix an empty string is a real choice ("run the file directly", e.g. a
  // shebang script): the OS honors the `#!` line, so it must NOT fall through to the
  // extension default.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: "python3",
      platform: "linux",
    }),
    ""
  );
});

test("resolveInterpreter: a blank command resolves to a real interpreter on Windows", () => {
  // Windows has no shebang honoring — a bare `.py` path opens via its file
  // association instead of running — so a blank "run directly" prefix must resolve
  // to the extension default (the reported bug: a pinned shebang script ran as a
  // bare path and never reached Python).
  assert.equal(
    resolveInterpreter({
      explicitCommand: "",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: "python3",
      platform: "win32",
    }),
    "python"
  );
});

test("resolveInterpreter: a blank command on Windows falls to the shebang when no default", () => {
  // No configured default for the extension, but the file declares an interpreter:
  // use it rather than running the bare path. The shebang's `python3` is normalized
  // to `python` on win32, where the `python3` name is only the Store alias stub.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "",
      ext: ".unknown",
      defaults: DEFAULTS,
      shebang: "python3",
      platform: "win32",
    }),
    "python"
  );
});

test("resolveInterpreter: an explicit python3 command is normalized to python on Windows", () => {
  // win32 has no `python3` executable — it is the Microsoft Store app-execution alias
  // that prints "Python was not found". A pin configured with the Unix name would
  // otherwise never run, so the explicit command is rewritten to the real `python`.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "python3",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "win32",
    }),
    "python"
  );
});

test("resolveInterpreter: python3 is left untouched off win32", () => {
  // On Unix `python3` is the canonical name; normalization must not touch it.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "python3",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "linux",
    }),
    "python3"
  );
});

test("resolveInterpreter: python3 normalization preserves trailing args on Windows", () => {
  // Only the leading `python3` token is rewritten; `-u` (and any other flags) survive.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "python3 -u",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "win32",
    }),
    "python -u"
  );
});

test("resolveInterpreter: a versioned or absolute python3 is left verbatim on Windows", () => {
  // `python3.12` and an absolute interpreter path name a specific runtime the caller
  // chose deliberately — only the bare `python3` token is the unrunnable Store stub.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "python3.12",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "win32",
    }),
    "python3.12"
  );
  assert.equal(
    resolveInterpreter({
      explicitCommand: "D:/Tools/Python/Python314/python.exe",
      ext: ".py",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "win32",
    }),
    "D:/Tools/Python/Python314/python.exe"
  );
});

test("resolveInterpreter: falls back to the extension default", () => {
  assert.equal(
    resolveInterpreter({
      explicitCommand: undefined,
      ext: ".py",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "linux",
    }),
    "python"
  );
});

test("resolveInterpreter: falls back to the shebang when no default", () => {
  assert.equal(
    resolveInterpreter({
      explicitCommand: undefined,
      ext: ".sh",
      defaults: DEFAULTS,
      shebang: "bash",
      platform: "linux",
    }),
    "bash"
  );
});

test("resolveInterpreter: no command, no default, no shebang -> run directly", () => {
  assert.equal(
    resolveInterpreter({
      explicitCommand: undefined,
      ext: ".txt",
      defaults: DEFAULTS,
      shebang: undefined,
      platform: "linux",
    }),
    ""
  );
});

test("isRunnablePlan: true for explicit command, default, or shebang", () => {
  assert.equal(
    isRunnablePlan({ explicitCommand: "", ext: ".txt", defaults: {}, hasShebang: false }),
    true
  );
  assert.equal(
    isRunnablePlan({ explicitCommand: undefined, ext: ".py", defaults: DEFAULTS, hasShebang: false }),
    true
  );
  assert.equal(
    isRunnablePlan({ explicitCommand: undefined, ext: ".sh", defaults: DEFAULTS, hasShebang: true }),
    true
  );
});

test("isRunnablePlan: false for a plain document with no interpreter", () => {
  assert.equal(
    isRunnablePlan({ explicitCommand: undefined, ext: ".md", defaults: DEFAULTS, hasShebang: false }),
    false
  );
});

test("quoteArg: wraps values with whitespace, leaves simple ones bare", () => {
  assert.equal(quoteArg("plain"), "plain");
  assert.equal(quoteArg("/a/b c/file.ts"), '"/a/b c/file.ts"');
});

test("quoteArg: escapes an embedded double quote", () => {
  assert.equal(quoteArg('say "hi"'), '"say \\"hi\\""');
});

test("assembleCommandLine: prefix + quoted file + quoted args", () => {
  assert.equal(
    assembleCommandLine({
      prefix: "python",
      fsPath: "/proj/my script.py",
      args: ["--out", "a b.txt"],
      includeFile: true,
    }),
    'python "/proj/my script.py" --out "a b.txt"'
  );
});

test("assembleCommandLine: a blank prefix runs the file directly (no leading space)", () => {
  assert.equal(
    assembleCommandLine({ prefix: "", fsPath: "/proj/run.sh", args: [], includeFile: true }),
    "/proj/run.sh"
  );
});

test("assembleCommandLine: includeFile=false omits the file (npm/make targets)", () => {
  // `npm run build` names its work in args; the file (package.json) is in cwd, not
  // on the command line.
  assert.equal(
    assembleCommandLine({
      prefix: "npm",
      fsPath: "/proj/package.json",
      args: ["run", "build"],
      includeFile: false,
    }),
    "npm run build"
  );
});

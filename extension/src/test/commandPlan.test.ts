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
  // use it rather than running the bare path.
  assert.equal(
    resolveInterpreter({
      explicitCommand: "",
      ext: ".unknown",
      defaults: DEFAULTS,
      shebang: "python3",
      platform: "win32",
    }),
    "python3"
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

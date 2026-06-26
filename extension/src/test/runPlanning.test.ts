// Unit tests for the pure run-planning + single-instance guard (roadmap 4.1 / 7.x).
// No process is launched here: planRun turns a pin + target into a concrete RunPlan
// (command line, cwd, env, location, elevation, unknown tokens), and runBlockReason
// decides whether a fresh run may start. The vscode surface used (workspace config,
// getWorkspaceFolder) is modeled by the stub; shebang reads and the cross-process lock
// touch the REAL filesystem against a temp dir / the OS temp lock dir.
//
// runBlockReason consults the module-level processRegistry and runLock singletons; the
// tests register / acquire under unique ids and clean up after, so neither leaks.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter as NodeEmitter } from "node:events";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  Uri,
  __setWorkspaceFolders,
  __setConfig,
  __resetConfig,
  type WorkspaceFolder,
} from "./_stub/vscode";
import type { Uri as VscodeUri } from "vscode";
import { planRun, runBlockReason, isRunnable } from "../exec/runPlanning";
import { processRegistry } from "../exec/processRegistry";
import * as runLock from "../exec/runLock";
import type { Pin } from "../model/pin";

const asUri = (u: Uri): VscodeUri => u as unknown as VscodeUri;

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  __resetConfig();
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-runplan-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  __resetConfig();
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

// A pin under the temp workspace. Callers override exec / flags per case.
function pin(over: Partial<Pin> = {}): Pin {
  return { id: "p1", path: "script.py", scope: "project", order: 0, ...over } as Pin;
}

function fileUri(rel: string): VscodeUri {
  return asUri(Uri.file(`${tmpDir}/${rel}`));
}

// A fake spawned child for the in-process running guard: only `pid` and `on` are read.
class FakeChild extends NodeEmitter {
  constructor(public readonly pid: number | undefined) {
    super();
  }
  kill(): boolean {
    return true;
  }
}
const asChild = (c: FakeChild): ChildProcess => c as unknown as ChildProcess;

// --- planRun ------------------------------------------------------------

test("planRun assembles <prefix> \"<file>\" <args> with an explicit command", () => {
  __setConfig("saropaWorkspace", "defaultUseIntegratedTerminal", true);
  const uri = fileUri("script.py");
  const plan = planRun(pin({ exec: { command: "python", args: ["-v"] } }), uri);
  assert.equal(plan.commandLine, `python "${tmpDir}/script.py" -v`);
  assert.equal(plan.cwd, tmpDir, "cwd defaults to the workspace root");
  assert.equal(plan.location, "terminal", "the workspace default routes to the terminal");
  assert.equal(plan.name, "script.py", "the label falls back to the file base name");
});

test("planRun resolves the interpreter from the extension defaults when no command is set", () => {
  __setConfig("saropaWorkspace", "interpreterDefaults", { ".py": "python3" });
  const plan = planRun(pin(), fileUri("script.py"));
  assert.ok(plan.commandLine.startsWith("python3 "), "the .py default prefix is applied");
});

test("planRun expands tokens and reports unknown $names", () => {
  // $fileName resolves; $nope is unknown — left literal and surfaced once.
  const plan = planRun(
    pin({ exec: { command: "echo", args: ["$fileName", "$nope"] } }),
    fileUri("script.py")
  );
  assert.ok(plan.commandLine.includes("script.py"), "$fileName expands to the base name");
  assert.ok(plan.commandLine.includes("$nope"), "an unknown token is left literal");
  assert.deepEqual(plan.unknownTokens, ["nope"], "the unknown token is reported once");
});

test("planRun omits the file path when includeFilePath is false", () => {
  // An npm-script / Make-target config names its work in args and runs against cwd.
  const plan = planRun(
    pin({ exec: { command: "npm", args: ["run", "build"], includeFilePath: false } }),
    fileUri("package.json")
  );
  assert.equal(plan.commandLine, "npm run build", "the file path is omitted");
});

test("planRun honors an explicit runLocation over the legacy boolean and the default", () => {
  // runLocation is the source of truth; it wins even when the deprecated boolean would
  // say otherwise.
  const plan = planRun(
    pin({ exec: { command: "x", runLocation: "background", useIntegratedTerminal: true } }),
    fileUri("script.py")
  );
  assert.equal(plan.location, "background");
});

test("planRun falls back to the legacy useIntegratedTerminal boolean when runLocation is unset", () => {
  const terminal = planRun(
    pin({ exec: { command: "x", useIntegratedTerminal: true } }),
    fileUri("a.py")
  );
  assert.equal(terminal.location, "terminal");
  const background = planRun(
    pin({ exec: { command: "x", useIntegratedTerminal: false } }),
    fileUri("a.py")
  );
  assert.equal(background.location, "background");
});

test("planRun only elevates an external run", () => {
  __setConfig("saropaWorkspace", "interpreterDefaults", {});
  const external = planRun(
    pin({ exec: { command: "x", runLocation: "external", elevated: true } }),
    fileUri("a.py")
  );
  assert.equal(external.elevated, true, "an external run honors elevation");
  // The same flag on a terminal run is ignored — elevation only applies externally.
  const terminal = planRun(
    pin({ exec: { command: "x", runLocation: "terminal", elevated: true } }),
    fileUri("a.py")
  );
  assert.equal(terminal.elevated, false, "elevation is ignored off the external path");
});

test("planRun carries env and the background extractResult regex", () => {
  const plan = planRun(
    pin({ exec: { command: "x", env: { FOO: "bar" }, extractResult: "url=(\\S+)" } }),
    fileUri("a.py")
  );
  assert.deepEqual(plan.env, { FOO: "bar" });
  assert.equal(plan.extractResult, "url=(\\S+)");
});

// --- isRunnable (shebang + defaults) ------------------------------------

test("isRunnable is true for an explicit command and false for a plain document", () => {
  // An explicit command (even empty) means runnable; a .md with no interpreter is not.
  nodeFs.writeFileSync(`${tmpDir}/notes.md`, "# notes\n");
  assert.equal(isRunnable(pin({ exec: { command: "pandoc" } }), `${tmpDir}/notes.md`), true);
  assert.equal(isRunnable(pin(), `${tmpDir}/notes.md`), false, "a plain doc is not runnable");
});

test("isRunnable honors a #! shebang on an extensionless script", () => {
  // No recognized extension and no configured default, but the file declares an
  // interpreter, so it is runnable through that shebang.
  const scriptPath = `${tmpDir}/deploy`;
  nodeFs.writeFileSync(scriptPath, "#!/usr/bin/env python3\nprint('hi')\n");
  assert.equal(isRunnable(pin({ path: "deploy" }), scriptPath), true);
});

test("planRun runs an extensionless shebang script through its declared interpreter", () => {
  // #!/usr/bin/env python3 -> the env wrapper is stripped, leaving python3 as the
  // resolved prefix.
  const scriptPath = `${tmpDir}/deploy`;
  nodeFs.writeFileSync(scriptPath, "#!/usr/bin/env python3\nprint('hi')\n");
  const plan = planRun(pin({ path: "deploy" }), asUri(Uri.file(scriptPath)));
  assert.ok(plan.commandLine.startsWith("python3 "), "the shebang interpreter leads the command");
});

// --- runBlockReason -----------------------------------------------------

test("runBlockReason is undefined when the pin is idle and unlocked", () => {
  assert.equal(runBlockReason(pin({ id: "rb-idle" })), undefined);
});

test("runBlockReason reports 'running' while a tracked run of the pin is in flight", () => {
  const pinId = "rb-running";
  const child = new FakeChild(123);
  processRegistry.register(pinId, asChild(child));
  try {
    assert.equal(runBlockReason(pin({ id: pinId })), "running", "an in-flight run blocks a second");
  } finally {
    child.emit("close");
  }
});

test("runBlockReason reports 'locked' when the cross-process lock is held by a live holder", () => {
  const pinId = "rb-locked";
  const lockName = "sw-runplan-lock";
  // The test process is alive, so the lock it acquires reads as held by a live holder.
  runLock.acquire(lockName, process.pid, "owner");
  try {
    assert.equal(runBlockReason(pin({ id: pinId, lockName })), "locked");
  } finally {
    runLock.release(lockName, process.pid);
  }
});

test("allowConcurrent opts the pin out of both guards", () => {
  const pinId = "rb-concurrent";
  const lockName = "sw-runplan-lock-2";
  const child = new FakeChild(456);
  processRegistry.register(pinId, asChild(child));
  runLock.acquire(lockName, process.pid, "owner");
  try {
    // Even with a tracked run AND a held lock, allowConcurrent permits a fresh run.
    assert.equal(
      runBlockReason(pin({ id: pinId, lockName, allowConcurrent: true })),
      undefined
    );
  } finally {
    child.emit("close");
    runLock.release(lockName, process.pid);
  }
});

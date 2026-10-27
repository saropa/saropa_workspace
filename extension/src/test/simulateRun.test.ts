// Tests for "Simulate Run": the Markdown preview of exactly what a run would do,
// for file shortcuts (command, folder, location, environment, answered prompts) and
// for url, shell, command and macro actions. Nothing is executed.

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
  __setInputHandler,
  __resetHandlers,
  __resetWarnings,
  __warningMessages,
  __infoMessages,
  __resetInfo,
  __providerRegistrations,
  __resetHosts,
  __recordedCommands,
  __resetRecordedCommands,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registrarContext } from "./registrarCheck";
import { ShortcutStore } from "../model/shortcutStore";
import { registerSimulationPreview, simulateRun } from "../commands/simulateRun";
import type { Shortcut } from "../model/shortcut";

interface ContentProvider {
  provideTextDocumentContent(uri: { toString(): string }): string;
}

const HEAD = "# Simulate Run: NAME\n\n> Dry run — nothing was executed. This is what a real run would do.\n\n";
let dir: string;
let store: ShortcutStore;
let ctx: ReturnType<typeof registrarContext>;

const head = (name: string): string => HEAD.replace("NAME", name);

function shortcut(partial: Record<string, unknown>): Shortcut {
  return { id: "s1", scope: "global", order: 0, path: "", label: "Thing", ...partial } as unknown as Shortcut;
}

function fileShortcut(name: string, exec?: Record<string, unknown>, extra: Record<string, unknown> = {}): Shortcut {
  return shortcut({ path: `${dir}/${name}`, exec, ...extra });
}

// The Markdown the last simulation published, read back through the registered provider.
function report(): string {
  const provider = __providerRegistrations().find((p) => p.id === "saropa-simulate")!.provider as ContentProvider;
  const last = __recordedCommands().at(-1)!;
  return provider.provideTextDocumentContent(last.args[0] as { toString(): string });
}

beforeEach(async () => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-sim-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(dir), name: "proj", index: 0 }]);
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  __resetRecordedCommands();
  store = new ShortcutStore(fakeContext());
  await store.init();
  ctx = registrarContext();
  registerSimulationPreview(ctx as never);
});

afterEach(() => {
  ctx.subscriptions.forEach((d) => d.dispose());
  __setWorkspaceFolders(undefined);
  __resetConfig();
  __resetWarnings();
  __resetInfo();
  __resetHandlers();
  __resetHosts();
  __resetRecordedCommands();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

test("registering adds the provider and keeps both disposables", () => {
  assert.deepEqual(__providerRegistrations().map((p) => [p.kind, p.id]), [["textDocumentContent", "saropa-simulate"]]);
  assert.equal(ctx.subscriptions.length, 2);
});

test("the preview opens by uri, keyed by shortcut id, with unsafe title characters replaced", async () => {
  await simulateRun(store, shortcut({ label: 'a/b:c', action: { kind: "url", url: "https://x.test" } }));
  const [call] = __recordedCommands();
  assert.equal(call.command, "markdown.showPreview");
  assert.equal((call.args[0] as { toString(): string }).toString(), "saropa-simulate:/s1/Simulate Run_ a_b_c.md");
});

test("a url action names the address", async () => {
  await simulateRun(store, shortcut({ action: { kind: "url", url: "https://x.test/p" } }));
  assert.equal(report(), head("Thing") + "Opens this URL in your browser:\n\n<https://x.test/p>\n");
});

test("a shell action shows the command and its folder", async () => {
  await simulateRun(store, shortcut({ action: { kind: "shell", shellCommand: "make all", cwd: "/work" } }));
  assert.equal(
    report(),
    head("Thing") + "Runs this shell command:\n\n```sh\nmake all\n```\n\n## Working directory\n\n```\n/work\n```\n"
  );
});

test("a command action shows the id and, when there are arguments, their JSON", async () => {
  await simulateRun(store, shortcut({ action: { kind: "command", commandId: "a.b" } }));
  assert.equal(report(), head("Thing") + "Invokes the VS Code command `a.b`.\n");
  await simulateRun(store, shortcut({ action: { kind: "command", commandId: "a.b", commandArgs: [1, "x"] } }));
  assert.equal(
    report(),
    head("Thing") + 'Invokes the VS Code command `a.b`.\n\n```json\n[\n  1,\n  "x"\n]\n```\n'
  );
});

test("a macro lists its steps in order with the target each would use", async () => {
  await simulateRun(
    store,
    shortcut({
      action: {
        kind: "macro",
        steps: [
          { kind: "open", path: "/a.txt", label: "Open it" },
          { kind: "shell", shellCommand: "echo hi" },
          { kind: "url", url: "https://x.test" },
          { kind: "command", commandId: "z.y" },
          { kind: "url" },
        ],
      },
    })
  );
  assert.equal(
    report(),
    head("Thing") +
      "## Runs these steps in order:\n\n" +
      "1. **Open it** — `/a.txt`\n" +
      "2. **shell** — `echo hi`\n" +
      "3. **url** — `https://x.test`\n" +
      "4. **command** — `z.y`\n" +
      "5. **url** — ``\n"
  );
});

test("a file shortcut shows its command line, folder, location and an empty environment", async () => {
  await simulateRun(store, fileShortcut("job.py", { command: "python3", args: ["--fast", "a b"], runLocation: "background" }));
  assert.equal(
    report(),
    head("Thing") +
      `## Command\n\n\`\`\`sh\npython3 ${dir}/job.py --fast "a b"\n\`\`\`\n\n` +
      `## Working directory\n\n\`\`\`\n${dir}\n\`\`\`\n\n` +
      "## Run location\n\nBackground output channel\n\n" +
      "## Environment overrides\n\n_(none)_\n"
  );
});

test("environment overrides are listed and each run location has its own label", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ runLocation: "terminal" }, "Integrated terminal"],
    [{ runLocation: "external" }, "New external window"],
    [{ runLocation: "external", elevated: true }, "New external window (administrator)"],
    [{ runLocation: "terminal", elevated: true }, "Integrated terminal"],
  ];
  for (const [exec, label] of cases) {
    await simulateRun(store, fileShortcut("job.py", { command: "python3", env: { A: "1", B: "two" }, ...exec }));
    const text = report();
    assert.ok(text.includes(`## Run location\n\n${label}\n\n`), label);
    assert.ok(text.endsWith("## Environment overrides\n\n- `A=1`\n- `B=two`\n"));
  }
});

test("a custom folder replaces the default and unknown placeholders are listed", async () => {
  await simulateRun(store, fileShortcut("job.py", { command: "python3", cwd: "/custom", args: ["$nope"], runLocation: "background" }));
  const text = report();
  assert.ok(text.includes("## Working directory\n\n```\n/custom\n```\n"));
  assert.ok(text.endsWith("## Unrecognized placeholders\n\n_Left literal in the command (they may be intentional shell variables)._\n\n- `$nope`\n"));
});

test("a run with an empty command line says it would open the file instead of showing an empty command", async () => {
  await simulateRun(store, fileShortcut("notes.zzz", { includeFilePath: false, runLocation: "background" }));
  const text = report();
  assert.ok(text.startsWith(head("Thing") + "_Thing has no run command, so running it would open the file in the editor instead._\n\n## Working directory"));
  assert.ok(!text.includes("## Command"));
});

test("answered prompts are used in the command and listed", async () => {
  __setInputHandler(async () => "Bob");
  await simulateRun(store, fileShortcut("job.py", { command: "python3", args: ["${prompt:Who}"], runLocation: "background" }));
  const text = report();
  assert.ok(text.includes(`python3 ${dir}/job.py Bob`));
  assert.ok(text.endsWith("## Answered prompts\n\n- `${prompt:Who}` → `Bob`\n"));
});

test("canceling a prompt renders nothing and says so", async () => {
  await simulateRun(store, fileShortcut("job.py", { command: "python3", args: ["${prompt:Who}"] }));
  assert.deepEqual(__infoMessages(), ["Simulation canceled for Thing."]);
  assert.deepEqual(__recordedCommands(), []);
});

test("a project shortcut that cannot be resolved warns and renders nothing", async () => {
  await simulateRun(store, shortcut({ scope: "project", path: "nowhere/x.py" }));
  assert.deepEqual(__warningMessages(), ["File not found: nowhere/x.py"]);
  assert.deepEqual(__recordedCommands(), []);
});

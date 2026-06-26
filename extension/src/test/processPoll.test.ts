// Unit tests for the developer process-monitor helpers (recipe book section G,
// #60-62). The live two-sample poll shells out to the OS, so it is left to a manual
// smoke test; the PURE pieces — the project-aware toolchain allowlist (activeToolDefs,
// which reads the modeled workspace.fs against a real temp tree), the kill-guard
// (isGroupKillable), the byte formatter (formatBytes), and the Markdown report builder
// (buildProcessReportMarkdown) — run under Node's built-in runner.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Uri, __setWorkspaceFolders, type WorkspaceFolder } from "./_stub/vscode";
import {
  activeToolDefs,
  isGroupKillable,
  formatBytes,
  buildProcessReportMarkdown,
  type PollResult,
} from "../exec/processPoll";

let tmpDir: string;
let folder: WorkspaceFolder;

beforeEach(() => {
  // A real temp folder so activeToolDefs's fileExists stats (modeled by the stub's
  // node-backed fs) hit a real tree — marker files are created per test.
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-procpoll-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});

afterEach(() => {
  __setWorkspaceFolders(undefined);
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

function touch(name: string): void {
  nodeFs.writeFileSync(nodePath.join(tmpDir, name), "");
}

// --- activeToolDefs: project-aware allowlist ----------------------------

test("activeToolDefs always includes the marker-free groups", async () => {
  // No marker files: only the always-on groups (editor, agent, shells) apply.
  const defs = await activeToolDefs();
  const tools = defs.map((d) => d.tool);
  assert.ok(tools.includes("Visual Studio Code"));
  assert.ok(tools.includes("Shells"));
  // A marker-gated group is absent without its marker file.
  assert.ok(!tools.includes("Dart toolchain"));
  assert.ok(!tools.includes("Node toolchain"));
});

test("activeToolDefs switches on a toolchain group when its marker file is present", async () => {
  // A package.json switches on the Node toolchain; pubspec.yaml the Dart one.
  touch("package.json");
  touch("pubspec.yaml");
  const tools = (await activeToolDefs()).map((d) => d.tool);
  assert.ok(tools.includes("Node toolchain"), "package.json enables the Node group");
  assert.ok(tools.includes("Dart toolchain"), "pubspec.yaml enables the Dart group");
  // A marker NOT present stays off.
  assert.ok(!tools.includes("Rust toolchain"), "no Cargo.toml -> no Rust group");
});

test("activeToolDefs enables Python on either of its marker files", async () => {
  // The python marker is satisfied by pyproject.toml OR requirements.txt; just one
  // is enough to switch the group on.
  touch("requirements.txt");
  const tools = (await activeToolDefs()).map((d) => d.tool);
  assert.ok(tools.includes("Python toolchain"));
});

// --- isGroupKillable: the End-task guard --------------------------------

test("isGroupKillable allows a developer group but never a protected one", () => {
  // A developer-owned group may be ended from the monitor; the container-runtime /
  // OS-owned Docker group is protected and never killable.
  assert.equal(isGroupKillable("Dart toolchain"), true);
  assert.equal(isGroupKillable("Docker"), false, "Docker is a protected group");
});

test("isGroupKillable is false for an unknown tool name", () => {
  // A tool that is not in the table cannot be killed — fail closed.
  assert.equal(isGroupKillable("Nonexistent toolchain"), false);
});

// --- formatBytes --------------------------------------------------------

test("formatBytes renders zero and bytes without a decimal", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
});

test("formatBytes scales to KB / MB / GB with one decimal under 100", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024 * 1.4), "1.4 MB");
});

test("formatBytes drops the decimal at or above 100 of a unit", () => {
  // 150 KB reads "150 KB", not "150.0 KB" — the decimal is noise at that magnitude.
  assert.equal(formatBytes(1024 * 150), "150 KB");
});

// --- buildProcessReportMarkdown -----------------------------------------

test("buildProcessReportMarkdown renders the group table and per-tool drill-down", () => {
  const result: PollResult = {
    cores: 8,
    totalRamBytes: 16 * 1024 * 1024 * 1024,
    freeRamBytes: 8 * 1024 * 1024 * 1024,
    sampledAt: Date.now(),
    groups: [
      {
        tool: "Dart toolchain",
        icon: "symbol-method",
        cpuPercent: 42.5,
        rssBytes: 1024 * 1024 * 512,
        pidCount: 2,
        procs: [
          { pid: 111, ppid: 1, name: "dart", rssBytes: 1024 * 1024 * 400, cpuPercent: 40 },
          { pid: 222, ppid: 111, name: "flutter_tester", rssBytes: 1024 * 1024 * 112, cpuPercent: 2.5 },
        ],
      },
    ],
  };
  const md = buildProcessReportMarkdown(result);
  // The summary table row carries the rolled-up CPU and PID count for the group.
  assert.ok(md.includes("| Dart toolchain | 42.5 |"), "group summary row with one-decimal CPU");
  assert.ok(md.includes("| 2 |"), "the group's PID count appears");
  // The per-tool section heads with the count and lists each PID.
  assert.ok(md.includes("## Dart toolchain (2 processes)"));
  assert.ok(md.includes("| 111 | dart | 40.0 |"), "the worst offender's PID row");
  assert.ok(md.includes("| 222 | flutter_tester | 2.5 |"));
});

test("buildProcessReportMarkdown notes the CPU column is a live delta, not cumulative", () => {
  const result: PollResult = {
    cores: 4,
    totalRamBytes: 1024,
    freeRamBytes: 512,
    sampledAt: Date.now(),
    groups: [],
  };
  const md = buildProcessReportMarkdown(result);
  // The caveat must appear so a reader does not mistake the column for lifetime CPU.
  assert.ok(md.includes("live two-sample delta"));
});

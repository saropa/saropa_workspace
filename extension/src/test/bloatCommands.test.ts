// Tests for the bloat-scan commands: the scan with its report and toast, the one-tap guard of a
// project's watcher excludes, and the confirm-gated prune of the .vscode-test cache.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  __registeredCommands, __infoMessages, __resetInfo, __warningMessages, __setWarningAnswer, __resetWarnings,
  __setConfig, __resetConfig, __openedDocuments, __resetOpenedDocuments, __resetHosts, __setWorkspaceFolders,
  __errorMessages,
} from "./_stub/vscode";
import { registerBloatCommands } from "../exec/bloatCommands";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { settle } from "./settle";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;

const run = (id: string, ...args: unknown[]): Promise<unknown> => Promise.resolve(__registeredCommands().get(`saropaWorkspace.recipe.${id}`)!(...args));
const settings = (root = fx.dir): Record<string, unknown> => JSON.parse(nodeFs.readFileSync(`${root}/.vscode/settings.json`, "utf8"));
const reportFiles = (root = fx.dir): string[] => {
  const base = `${root}/reports`;
  return nodeFs.existsSync(base) ? nodeFs.readdirSync(base, { recursive: true }).map(String).filter((f) => f.endsWith("_workspace_hygiene.md")) : [];
};

// Two files over a tiny ceiling make "dist" oversized by count.
function makeOversized(root: string, name = "dist"): void {
  nodeFs.mkdirSync(`${root}/${name}`, { recursive: true });
  for (const f of ["a", "b", "c"]) {
    nodeFs.writeFileSync(`${root}/${name}/${f}.js`, "x");
  }
}

beforeEach(() => {
  fx = createFsFixture("sw-bloat-");
  __setConfig("saropaWorkspace.hygiene", "bloat.fileCountCeiling", 2);
  registerBloatCommands(registrarContext());
});

afterEach(() => {
  fx.remove();
  __resetConfig();
  __resetInfo();
  __resetWarnings();
  __resetHosts();
  __resetOpenedDocuments();
});

test("it registers exactly the three bloat commands", () => {
  const ids = captureRegistrations(() => registerBloatCommands(registrarContext()));
  assert.deepEqual(ids, [
    "saropaWorkspace.recipe.runBloatScan",
    "saropaWorkspace.recipe.guardProject",
    "saropaWorkspace.recipe.pruneVscodeTest",
  ]);
});

test("a scan with nothing oversized writes the report and reports the project count quietly", async () => {
  nodeFs.mkdirSync(`${fx.dir}/src`);
  nodeFs.writeFileSync(`${fx.dir}/src/a.ts`, "x");
  await run("runBloatScan");
  assert.deepEqual(__infoMessages(), [l10n("bloat.clean", { count: 1 })]);
  assert.deepEqual(__warningMessages(), []);
  assert.equal(reportFiles().length, 1);
});

test("a scan with no folder open warns and writes nothing", async () => {
  __setWorkspaceFolders(undefined);
  await run("runBloatScan");
  assert.deepEqual(__warningMessages(), [l10n("bloat.noFolder")]);
});

test("an oversized folder raises a warning offering Open report and Guard, and Open report opens the written report", async () => {
  makeOversized(fx.dir);
  let offered: string[] = [];
  __setWarningAnswer((_m, items) => {
    offered = items;
    return l10n("bloat.openReport");
  });
  await run("runBloatScan");
  await settle(() => __openedDocuments().length === 1);
  assert.deepEqual(__warningMessages(), [l10n("bloat.found", { count: 1 })]);
  assert.deepEqual(offered, [l10n("bloat.openReport"), l10n("bloat.guardAction")]);
  const [report] = reportFiles();
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/reports/${report.replace(/\\/g, "/")}`]);
  const body = nodeFs.readFileSync(__openedDocuments()[0], "utf8");
  assert.match(body, /dist/);
  assert.match(body, /\*\*\/dist\/\*\*/);
});

test("choosing Guard adds the flagged glob to files.watcherExclude", async () => {
  makeOversized(fx.dir);
  __setWarningAnswer(() => l10n("bloat.guardAction"));
  await run("runBloatScan");
  await settle(() => __infoMessages().length === 1);
  assert.deepEqual(settings(), { "files.watcherExclude": { "**/dist/**": true } });
  assert.deepEqual(__infoMessages(), [l10n("bloat.guarded", { count: 1, project: nodePath.basename(fx.dir) })]);
});

test("a glob that is already excluded is not a finding, so the scan is clean", async () => {
  makeOversized(fx.dir);
  nodeFs.mkdirSync(`${fx.dir}/.vscode`);
  nodeFs.writeFileSync(`${fx.dir}/.vscode/settings.json`, JSON.stringify({ "files.watcherExclude": { "**/dist/**": true } }));
  await run("runBloatScan");
  assert.deepEqual(__infoMessages(), [l10n("bloat.clean", { count: 1 })]);
});

test("findings in two projects offer only Open report", async () => {
  const parent = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bloat-parent-")).replace(/\\/g, "/");
  try {
    makeOversized(`${parent}/one`);
    makeOversized(`${parent}/two`);
    __setConfig("saropaWorkspace.hygiene", "roots", [parent]);
    let offered: string[] = [];
    __setWarningAnswer((_m, items) => {
      offered = items;
      return undefined;
    });
    await run("runBloatScan");
    await settle(() => offered.length > 0);
    assert.deepEqual(offered, [l10n("bloat.openReport")]);
    assert.deepEqual(__warningMessages(), [l10n("bloat.found", { count: 2 })]);
  } finally {
    nodeFs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a configured parent that cannot be read is skipped without failing the scan", async () => {
  __setConfig("saropaWorkspace.hygiene", "roots", [`${fx.dir}/does-not-exist`]);
  await run("runBloatScan");
  assert.deepEqual(__infoMessages(), [l10n("bloat.clean", { count: 1 })]);
});

test("a ceiling setting of zero or less falls back to the default, so a small folder stays clean", async () => {
  __setConfig("saropaWorkspace.hygiene", "bloat.fileCountCeiling", 0);
  __setConfig("saropaWorkspace.hygiene", "bloat.folderCeilingMB", -5);
  makeOversized(fx.dir);
  await run("runBloatScan");
  assert.deepEqual(__infoMessages(), [l10n("bloat.clean", { count: 1 })]);
});

test("a folder ceiling in megabytes flags a folder over it", async () => {
  __setConfig("saropaWorkspace.hygiene", "bloat.fileCountCeiling", 1000);
  __setConfig("saropaWorkspace.hygiene", "bloat.folderCeilingMB", 0.00001);
  nodeFs.mkdirSync(`${fx.dir}/big`);
  nodeFs.writeFileSync(`${fx.dir}/big/data.bin`, Buffer.alloc(100));
  await run("runBloatScan");
  assert.deepEqual(__warningMessages(), [l10n("bloat.found", { count: 1 })]);
});

test("a failed report write is reported as an error and the findings are still announced", async () => {
  makeOversized(fx.dir);
  nodeFs.writeFileSync(`${fx.dir}/reports`, "a file where the folder should be");
  const before = __errorMessages().length;
  await run("runBloatScan");
  assert.equal(__errorMessages().length, before + 1);
  assert.match(__errorMessages()[before], /^Could not write the workspace bloat report: /);
  assert.deepEqual(__warningMessages(), [l10n("bloat.found", { count: 1 })]);
});

test("guardProject merges globs into an existing watcherExclude and keeps other settings", async () => {
  nodeFs.mkdirSync(`${fx.dir}/.vscode`);
  nodeFs.writeFileSync(`${fx.dir}/.vscode/settings.json`, JSON.stringify({ "editor.tabSize": 2, "files.watcherExclude": { "**/old/**": true } }));
  await run("guardProject", fx.dir, "**/dist/**");
  assert.deepEqual(settings(), { "editor.tabSize": 2, "files.watcherExclude": { "**/old/**": true, "**/dist/**": true } });
  assert.deepEqual(__infoMessages(), [l10n("bloat.guarded", { count: 1, project: nodePath.basename(fx.dir) })]);
});

test("guarding a glob that is already excluded changes nothing and says so", async () => {
  nodeFs.mkdirSync(`${fx.dir}/.vscode`);
  nodeFs.writeFileSync(`${fx.dir}/.vscode/settings.json`, JSON.stringify({ "files.watcherExclude": { "**/dist/**": true } }));
  await run("guardProject", fx.dir, "**/dist/**");
  assert.deepEqual(settings(), { "files.watcherExclude": { "**/dist/**": true } });
  assert.deepEqual(__infoMessages(), [l10n("bloat.guardedNoop", { project: nodePath.basename(fx.dir) })]);
});

test("guardProject refuses a project that is not the open workspace", async () => {
  const other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bloat-other-")).replace(/\\/g, "/");
  try {
    await run("guardProject", other, "**/dist/**");
    assert.deepEqual(__warningMessages(), [l10n("bloat.guardForeign", { project: nodePath.basename(other) })]);
    assert.equal(nodeFs.existsSync(`${other}/.vscode`), false);
  } finally {
    nodeFs.rmSync(other, { recursive: true, force: true });
  }
});

test("guardProject without a root or a glob does nothing", async () => {
  await run("guardProject");
  await run("guardProject", fx.dir);
  await run("guardProject", fx.dir, "");
  assert.deepEqual([__infoMessages(), __warningMessages(), nodeFs.existsSync(`${fx.dir}/.vscode`)], [[], [], false]);
});

test("a settings file that cannot be parsed is left untouched and a warning names it", async () => {
  nodeFs.mkdirSync(`${fx.dir}/.vscode`);
  const text = '{ // a comment\n "editor.tabSize": 2 }';
  nodeFs.writeFileSync(`${fx.dir}/.vscode/settings.json`, text);
  await run("guardProject", fx.dir, "**/dist/**");
  assert.equal(nodeFs.readFileSync(`${fx.dir}/.vscode/settings.json`, "utf8"), text);
  assert.deepEqual(__warningMessages(), [l10n("bloat.guardUnparseable", { path: `${fx.dir}/.vscode/settings.json` })]);
});

test("pruning a project with no .vscode-test folder says there is nothing to prune", async () => {
  await run("pruneVscodeTest");
  nodeFs.writeFileSync(`${fx.dir}/.vscode-test`, "a file");
  await run("pruneVscodeTest", fx.dir);
  assert.deepEqual(__infoMessages(), [l10n("bloat.pruneAbsent"), l10n("bloat.pruneAbsent")]);
});

test("pruning asks first with the exact size, and declining keeps the cache", async () => {
  nodeFs.mkdirSync(`${fx.dir}/.vscode-test/a`, { recursive: true });
  nodeFs.writeFileSync(`${fx.dir}/.vscode-test/a/x.bin`, Buffer.alloc(3 * 1024 * 1024));
  let offered: string[] = [];
  __setWarningAnswer((_m, items) => {
    offered = items;
    return undefined;
  });
  await run("pruneVscodeTest");
  assert.deepEqual(__warningMessages(), [l10n("bloat.pruneMessage", { project: nodePath.basename(fx.dir), size: "3 MB" })]);
  assert.deepEqual(offered, [l10n("bloat.pruneConfirm")]);
  assert.equal(nodeFs.existsSync(`${fx.dir}/.vscode-test/a/x.bin`), true);
});

test("confirming deletes the cache and reports the size reclaimed", async () => {
  nodeFs.mkdirSync(`${fx.dir}/.vscode-test`);
  nodeFs.writeFileSync(`${fx.dir}/.vscode-test/x.bin`, Buffer.alloc(2 * 1024 * 1024));
  __setWarningAnswer(() => l10n("bloat.pruneConfirm"));
  await run("pruneVscodeTest", fx.dir);
  assert.equal(nodeFs.existsSync(`${fx.dir}/.vscode-test`), false);
  assert.deepEqual(__infoMessages(), [l10n("bloat.pruned", { project: nodePath.basename(fx.dir), size: "2 MB" })]);
});

test("pruning refuses a project that is not the open workspace and deletes nothing", async () => {
  const other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-bloat-other-")).replace(/\\/g, "/");
  try {
    nodeFs.mkdirSync(`${other}/.vscode-test`);
    __setWarningAnswer(() => l10n("bloat.pruneConfirm"));
    await run("pruneVscodeTest", other);
    assert.deepEqual(__warningMessages(), [l10n("bloat.guardForeign", { project: nodePath.basename(other) })]);
    assert.equal(nodeFs.existsSync(`${other}/.vscode-test`), true);
  } finally {
    nodeFs.rmSync(other, { recursive: true, force: true });
  }
});

test("pruning with no folder open and no root does nothing", async () => {
  __setWorkspaceFolders(undefined);
  await run("pruneVscodeTest");
  assert.deepEqual([__infoMessages(), __warningMessages()], [[], []]);
});

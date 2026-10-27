// Tests for the hygiene-scan commands: the settings-driven scan, the saved-scan wizard and the
// re-run of a saved scan, including how a stored config is validated and what the report holds.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Uri, __registeredCommands, __infoMessages, __resetInfo, __warningMessages, __setWarningAnswer, __resetWarnings,
  __setConfig, __resetConfig, __openedDocuments, __resetOpenedDocuments, __resetHosts, __setWorkspaceFolders,
  __resetHandlers, __setOpenDialogHandler, __errorMessages,
} from "./_stub/vscode";
import { fakeContext } from "./_stub/context";
import { registerHygieneCommands } from "../exec/hygieneCommands";
import { ShortcutStore } from "../model/shortcutStore";
import { registrarContext, captureRegistrations } from "./registrarCheck";
import { createFsFixture, type FsFixture } from "./fsFixture";
import { drivePicks, driveInputs } from "./uiDrivers";
import { settle } from "./settle";
import { l10n } from "../i18n/l10n";

let fx: FsFixture;
let store: ShortcutStore;
const run = (id: string, ...args: unknown[]): Promise<unknown> => Promise.resolve(__registeredCommands().get(`saropaWorkspace.recipe.${id}`)!(...args));
const reportFiles = (): string[] =>
  nodeFs.existsSync(`${fx.dir}/reports`)
    ? nodeFs.readdirSync(`${fx.dir}/reports`, { recursive: true }).map(String).filter((f) => f.endsWith("_filereport.json"))
    : [];
const readReport = (): { findings: Array<{ relPath: string; kind: string }>; mode: string; scope: string[] } =>
  JSON.parse(nodeFs.readFileSync(`${fx.dir}/reports/${reportFiles()[0]}`, "utf8"));

beforeEach(async () => {
  fx = createFsFixture("sw-hygiene-");
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  store = new ShortcutStore(fakeContext());
  await store.init();
  registerHygieneCommands(registrarContext(), store);
});

afterEach(() => {
  fx.remove();
  __resetConfig();
  __resetInfo();
  __resetWarnings();
  __resetHosts();
  __resetOpenedDocuments();
  __resetHandlers();
});

test("it registers exactly the three hygiene commands", () => {
  const ids = captureRegistrations(() => registerHygieneCommands(registrarContext(), store));
  assert.deepEqual(ids, [
    "saropaWorkspace.recipe.runHygieneScan",
    "saropaWorkspace.recipe.newHygieneScan",
    "saropaWorkspace.recipe.runSavedHygieneScan",
  ]);
});

test("the settings scan with no folder open warns", async () => {
  __setWorkspaceFolders(undefined);
  await run("runHygieneScan");
  assert.deepEqual(__warningMessages(), [l10n("hygiene.noFolder")]);
});

test("a clean project is reported quietly with the counts, and the report is still written", async () => {
  fx.write("src/a.ts", "x");
  await run("runHygieneScan");
  // The store's own .saropa folder and project file are scanned too: 2 files in 3 folders.
  assert.deepEqual(__infoMessages(), [l10n("hygiene.clean", { files: 2, dirs: 3 })]);
  assert.equal(reportFiles().length, 1);
  assert.deepEqual(readReport().findings, []);
});

test("an empty file is a finding: a sticky warning with Open report, and the report lists it", async () => {
  fx.write("empty.txt", "");
  let offered: string[] = [];
  __setWarningAnswer((_m, items) => {
    offered = items;
    return l10n("hygiene.openReport");
  });
  await run("runHygieneScan");
  await settle(() => __openedDocuments().length === 1);
  assert.deepEqual(__warningMessages(), [l10n("hygiene.found", { count: 1, more: "" })]);
  assert.deepEqual(offered, [l10n("hygiene.openReport")]);
  assert.deepEqual(readReport().findings.map((f) => [f.relPath, f.kind]), [["empty.txt", "emptyFile"]]);
  assert.deepEqual(__openedDocuments(), [`${fx.dir}/reports/${reportFiles()[0]}`.replace(/\\/g, "/")]);
});

test("the scan mode and size settings decide what is flagged", async () => {
  fx.write("big.bin", Buffer.alloc(2048, 1).toString());
  fx.write("empty.txt", "");
  __setConfig("saropaWorkspace.hygiene", "mode", "oversized");
  __setConfig("saropaWorkspace.hygiene", "fileMaxMB", 0.001);
  await run("runHygieneScan");
  await settle(() => __warningMessages().length === 1);
  assert.deepEqual(readReport().findings.map((f) => [f.relPath, f.kind]), [["big.bin", "largeFile"]]);
});

test("a saved scan with a config that is not an object or has no roots is refused", async () => {
  for (const config of [undefined, null, "x", 3, {}, { roots: [] }, { roots: [5] }]) {
    await run("runSavedHygieneScan", config);
  }
  assert.deepEqual(__warningMessages(), new Array(7).fill(l10n("hygiene.savedInvalid")));
});

test("a saved scan runs its stored roots and mode, filling missing numbers with the defaults", async () => {
  fx.write("sub/empty.txt", "");
  fx.write("sub/big.txt", "x".repeat(10));
  await run("runSavedHygieneScan", { roots: [`${fx.dir}/sub`], mode: "empty", fileMaxBytes: "bad", folderMaxBytes: -1 });
  await settle(() => __warningMessages().length === 1);
  const report = readReport();
  assert.deepEqual(report.scope, [`${fx.dir}/sub`]);
  assert.equal(report.mode, "empty");
  assert.deepEqual(report.findings.map((f) => f.relPath), ["empty.txt"]);
  assert.deepEqual((report as unknown as { thresholds: unknown }).thresholds, { fileMaxBytes: 100 * 1024 * 1024, folderMaxBytes: 1024 * 1024 * 1024 });
});

test("an unknown stored mode becomes both", async () => {
  fx.write("e.txt", "");
  await run("runSavedHygieneScan", { roots: [fx.dir], mode: "weird" });
  await settle(() => __warningMessages().length === 1);
  assert.equal(readReport().mode, "both");
});

test("with no workspace folder a saved scan writes its report under the scanned root", async () => {
  __setWorkspaceFolders(undefined);
  const external = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-hygiene-ext-")).replace(/\\/g, "/");
  try {
    nodeFs.writeFileSync(`${external}/a.txt`, "x");
    await run("runSavedHygieneScan", { roots: [external] });
    assert.deepEqual(__infoMessages(), [l10n("hygiene.clean", { files: 1, dirs: 1 })]);
    assert.equal(nodeFs.readdirSync(`${external}/reports`, { recursive: true }).map(String).filter((f) => f.endsWith("_filereport.json")).length, 1);
  } finally {
    nodeFs.rmSync(external, { recursive: true, force: true });
  }
});

test("a report that cannot be written is an error and no result toast is shown", async () => {
  fx.write("reports", "a file where the folder should go");
  const before = __errorMessages().length;
  await run("runHygieneScan");
  assert.equal(__errorMessages().length, before + 1);
  assert.match(__errorMessages()[before], /^Could not write the hygiene report: /);
  assert.deepEqual(__infoMessages(), []);
});

test("the wizard saves a scan shortcut named after the folder, mode and file ceiling", async () => {
  const picks = drivePicks(`$(root-folder) proj`, l10n("hygiene.new.mode.oversized"));
  const inputs = driveInputs("50", "2048");
  await run("newHygieneScan");
  assert.deepEqual(picks[0].rows.map((r) => r.label), [`$(root-folder) proj`, l10n("hygiene.new.browse")]);
  assert.deepEqual(picks[1].rows.map((r) => r.label), [l10n("hygiene.new.mode.both"), l10n("hygiene.new.mode.empty"), l10n("hygiene.new.mode.oversized")]);
  assert.deepEqual(inputs.map((i) => [i.prompt, i.value]), [
    [l10n("hygiene.new.fileCeilingPrompt"), "100"],
    [l10n("hygiene.new.folderCeilingPrompt"), "1024"],
  ]);
  const name = l10n("hygiene.new.name", { scope: nodePath.basename(fx.dir), detail: "oversized, files >50MB" });
  assert.deepEqual(__infoMessages(), [l10n("hygiene.new.saved", { name })]);
  const saved = store.getProjectShortcuts().find((p) => !p.isAuto && p.label === name)!;
  assert.deepEqual(saved.action, {
    kind: "command",
    commandId: "saropaWorkspace.recipe.runSavedHygieneScan",
    commandArgs: [{
      roots: [fx.dir], mode: "oversized", fileMaxBytes: 50 * 1024 * 1024, folderMaxBytes: 2048 * 1024 * 1024,
      respectGitignore: true, excludeGlobs: [],
    }],
  });
  assert.deepEqual([saved.icon, saved.color], ["search", "charts.blue"]);
});

test("the empty-only wizard asks for no ceilings and its name has no size part", async () => {
  drivePicks(`$(root-folder) proj`, l10n("hygiene.new.mode.empty"));
  const inputs = driveInputs();
  await run("newHygieneScan");
  assert.equal(inputs.length, 0);
  const name = l10n("hygiene.new.name", { scope: nodePath.basename(fx.dir), detail: "empty" });
  assert.deepEqual(__infoMessages(), [l10n("hygiene.new.saved", { name })]);
});

test("the ceiling prompts only accept a number above zero", async () => {
  drivePicks(`$(root-folder) proj`, l10n("hygiene.new.mode.both"));
  const inputs = driveInputs("10", "10");
  await run("newHygieneScan");
  const validate = inputs[0].validateInput!;
  assert.equal(validate("12"), undefined);
  assert.equal(validate(" 1.5 "), undefined);
  for (const bad of ["0", "-3", "abc", ""]) {
    assert.equal(validate(bad), l10n("hygiene.new.numberInvalid"), JSON.stringify(bad));
  }
});

test("canceling the scope, the mode or a ceiling saves nothing", async () => {
  const count = (): number => store.getProjectShortcuts().filter((p) => !p.isAuto).length;
  drivePicks(undefined);
  await run("newHygieneScan");
  drivePicks(`$(root-folder) proj`, undefined);
  await run("newHygieneScan");
  drivePicks(`$(root-folder) proj`, l10n("hygiene.new.mode.both"));
  driveInputs(undefined);
  await run("newHygieneScan");
  drivePicks(`$(root-folder) proj`, l10n("hygiene.new.mode.both"));
  driveInputs("10", undefined);
  await run("newHygieneScan");
  assert.deepEqual([count(), __infoMessages(), __warningMessages()], [0, [], []]);
});

test("choosing to browse for a folder scans that folder", async () => {
  const other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-hygiene-browse-")).replace(/\\/g, "/");
  try {
    drivePicks(l10n("hygiene.new.browse"), l10n("hygiene.new.mode.empty"));
    __setOpenDialogHandler(async () => [Uri.file(other)]);
    await run("newHygieneScan");
    const saved = store.getProjectShortcuts().find((p) => !p.isAuto && p.label?.startsWith("Hygiene:"))!;
    assert.deepEqual((saved.action!.commandArgs![0] as { roots: string[] }).roots, [other]);
    assert.equal(saved.label, l10n("hygiene.new.name", { scope: nodePath.basename(other), detail: "empty" }));
  } finally {
    nodeFs.rmSync(other, { recursive: true, force: true });
  }
});

test("canceling the folder browser saves nothing", async () => {
  drivePicks(l10n("hygiene.new.browse"));
  __setOpenDialogHandler(async () => undefined);
  await run("newHygieneScan");
  assert.deepEqual(store.getProjectShortcuts().filter((p) => !p.isAuto), []);
});

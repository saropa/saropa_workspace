// Open beside, host wiring: the group a board document opens in reaches showTextDocument.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { documentColumn, openDocument, setBoardColumnSource } from "../../views/boardPanelActions";
import { openRulesFile } from "../../commands/boardRules";
import { startBugDocument } from "../../commands/boardLive";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as {
  __setTabGroups(g: unknown[]): void;
  __setConfig(section: string, key: string, value: unknown): void;
  __resetHosts(): void;
  __shownEditors(): ReadonlyArray<{ viewColumn: number | undefined }>;
  __resetOpenedDocuments(): void;
};
const SECTION = "saropaWorkspace.releaseBoard";

function groups(active: number): void {
  vs.__setTabGroups([
    { viewColumn: 1, tabs: [], isActive: active === 1 },
    { viewColumn: 2, tabs: [], isActive: active === 2 }
  ]);
}

afterEach(() => {
  setBoardColumnSource(() => undefined);
  vs.__resetHosts();
  vs.__resetOpenedDocuments();
  vs.__setConfig(SECTION, "openBeside", undefined);
  vs.__setConfig(SECTION, "placement", undefined);
  stub.__setWorkspaceFolders(undefined);
});

test("documentColumn reads the tab groups and the board column", () => {
  groups(2);
  setBoardColumnSource(() => 2);
  assert.equal(documentColumn(), 1);
  groups(1);
  setBoardColumnSource(() => 1);
  assert.equal(documentColumn(), 2);
});

test("documentColumn is undefined when the switch is off or the board shares a group", () => {
  groups(2);
  setBoardColumnSource(() => 2);
  vs.__setConfig(SECTION, "openBeside", false);
  assert.equal(documentColumn(), undefined);
  vs.__setConfig(SECTION, "openBeside", true);
  vs.__setConfig(SECTION, "placement", "sameGroup");
  assert.equal(documentColumn(), undefined);
});

test("documentColumn is undefined again once the board column source is reset", () => {
  groups(2);
  setBoardColumnSource(() => 2);
  assert.equal(documentColumn(), 1);
  setBoardColumnSource(() => undefined);
  assert.equal(documentColumn(), undefined);
});

test("openDocument passes the group to the editor", async () => {
  groups(2);
  setBoardColumnSource(() => 2);
  await openDocument(vscode.Uri.file("/tmp/a.md"));
  assert.equal(vs.__shownEditors().at(-1)?.viewColumn, 1);
});

test("the rules file opens in the given group, and in the editor's choice without one", async () => {
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(tmpDir()), name: "app", index: 0 }]);
  await openRulesFile(undefined, 1);
  assert.equal(vs.__shownEditors().at(-1)?.viewColumn, 1);
  await openRulesFile();
  assert.equal(vs.__shownEditors().at(-1)?.viewColumn, undefined);
});

test("a new bug document opens in the given group", async () => {
  const dir = tmpDir();
  const u = { project: "app", projectName: "app", file: "lib/a.dart", logs: { crashes: 1 }, folder: "bugs" };
  const ok = await startBugDocument(vscode.Uri.file(dir), u as never, 7, 1);
  assert.equal(ok, true);
  assert.equal(vs.__shownEditors().at(-1)?.viewColumn, 1);
});

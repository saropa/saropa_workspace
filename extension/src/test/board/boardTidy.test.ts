// Tidy sweep host side: settings, and the refusals before a document is moved. Every
// refusal happens before the confirmation, so nothing here touches a file.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { TidyCandidate } from "../../board/tidy";
import { moveToArchive, readTidySettings, sourceProblem } from "../../commands/boardTidy";
import { l10n } from "../../i18n/l10n";
import { stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  stub.__resetConfig();
  stub.__resetWarnings();
});

function candidate(mtimeMs: number, over: Partial<TidyCandidate> = {}): TidyCandidate {
  return { id: 0, project: "app", projectName: "App", path: "docs/old.md", title: "Old", stepsDone: 3, idleDays: 90, mtimeMs, to: "docs/archive/old.md", ...over };
}

function project(): { root: vscode.Uri; file: string; mtime: number } {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "docs"));
  const file = path.join(dir, "docs", "old.md");
  fs.writeFileSync(file, "# old");
  return { root: vscode.Uri.file(dir), file, mtime: Math.trunc(fs.statSync(file).mtimeMs) };
}

test("settings are undefined when the sweep is off", () => {
  stub.__setConfig("saropaWorkspace.releaseBoard.tidy", "enabled", false);
  assert.equal(readTidySettings(), undefined);
});

test("settings are clamped and the folder is cleaned", () => {
  const s = readTidySettings();
  assert.ok(s && s.afterDays > 0 && s.archiveFolder.length > 0);
  stub.__setConfig("saropaWorkspace.releaseBoard.tidy", "afterDays", -5);
  assert.ok((readTidySettings()?.afterDays ?? 0) >= 1);
});

test("a source that is missing is gone, one that moved on is changed, an unchanged one is fine", async () => {
  const p = project();
  const uri = vscode.Uri.file(p.file);
  assert.equal(await sourceProblem(uri, candidate(p.mtime)), undefined);
  assert.equal(await sourceProblem(uri, candidate(p.mtime - 60_000)), "changed");
  assert.equal(await sourceProblem(vscode.Uri.file(p.file + ".none"), candidate(p.mtime)), "gone");
});

const tidy = (key: string, vars: Record<string, string>): string => l10n(key, vars);
const docs = vscode.workspace.textDocuments as unknown as Array<{ isDirty: boolean; uri: vscode.Uri }>;

test("a move is refused, with the changed warning, when the file changed since the scan", async () => {
  const p = project();
  assert.equal(await moveToArchive(p.root, candidate(p.mtime - 60_000)), false);
  assert.deepEqual(stub.__warningMessages(), [tidy("releaseBoard.tidy.changed", { path: "docs/old.md" })]);
  assert.ok(fs.existsSync(p.file));
});

test("a move is refused, with the gone warning, when the file is missing", async () => {
  const p = project();
  assert.equal(await moveToArchive(p.root, candidate(p.mtime, { path: "docs/none.md" })), false);
  assert.deepEqual(stub.__warningMessages(), [tidy("releaseBoard.tidy.gone", { path: "docs/none.md" })]);
});

test("a move is refused when the destination already exists, and that file is not overwritten", async () => {
  const p = project();
  const target = path.join(p.root.fsPath, "docs", "archive", "old.md");
  fs.mkdirSync(path.dirname(target));
  fs.writeFileSync(target, "taken");
  assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  assert.deepEqual(stub.__warningMessages(), [tidy("releaseBoard.tidy.targetExists", { path: "docs/archive/old.md" })]);
  assert.equal(fs.readFileSync(target, "utf8"), "taken");
});

test("a move is refused when the document has unsaved edits", async () => {
  const p = project();
  docs.push({ isDirty: true, uri: vscode.Uri.file(p.file) });
  try {
    assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  } finally {
    docs.length = 0;
  }
  assert.deepEqual(stub.__warningMessages(), [tidy("releaseBoard.tidy.dirty", { path: "docs/old.md" })]);
  assert.ok(fs.existsSync(p.file));
});

test("a move the owner does not confirm shows the confirmation and leaves the file alone", async () => {
  const p = project();
  assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  assert.deepEqual(stub.__warningMessages(), [tidy("releaseBoard.tidy.confirm", { from: "docs/old.md", to: "docs/archive/old.md" })]);
  assert.ok(fs.existsSync(p.file));
});

test("a file that changes while the dialog is open is not moved", async () => {
  const p = project();
  stub.__setWarningAnswer((message, items) => {
    if (message === tidy("releaseBoard.tidy.confirm", { from: "docs/old.md", to: "docs/archive/old.md" })) {
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(p.file, later, later);
      return items[0];
    }
    return undefined;
  });
  assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  assert.equal(stub.__warningMessages().at(-1), tidy("releaseBoard.tidy.changed", { path: "docs/old.md" }));
  assert.ok(fs.existsSync(p.file));
});

test("a file edited in the editor while the dialog is open is not moved", async () => {
  const p = project();
  stub.__setWarningAnswer((message, items) => {
    if (message === tidy("releaseBoard.tidy.confirm", { from: "docs/old.md", to: "docs/archive/old.md" })) {
      docs.push({ isDirty: true, uri: vscode.Uri.file(p.file) });
      return items[0];
    }
    return undefined;
  });
  try {
    assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  } finally {
    docs.length = 0;
  }
  assert.equal(stub.__warningMessages().at(-1), tidy("releaseBoard.tidy.changed", { path: "docs/old.md" }));
  assert.ok(fs.existsSync(p.file));
});

test("a confirmed move renames the document into the archive folder", async () => {
  const p = project();
  stub.__setWarningAnswer((_m, items) => items[0]);
  assert.equal(await moveToArchive(p.root, candidate(p.mtime)), true);
  assert.equal(fs.existsSync(p.file), false);
  assert.equal(fs.readFileSync(path.join(p.root.fsPath, "docs", "archive", "old.md"), "utf8"), "# old");
  assert.equal(stub.__warningMessages().length, 1);
});

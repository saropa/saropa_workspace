// Tidy sweep host side: settings, and the refusals before a document is moved. Every
// refusal happens before the confirmation, so nothing here touches a file.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { TidyCandidate } from "../../board/tidy";
import { moveToArchive, readTidySettings, sourceProblem } from "../../commands/boardTidy";
import { stub, tmpDir } from "./hostHelpers";

afterEach(() => stub.__resetConfig());

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

test("a move is refused, and nothing is touched, when the file changed since the scan", async () => {
  const p = project();
  assert.equal(await moveToArchive(p.root, candidate(p.mtime - 60_000)), false);
  assert.ok(fs.existsSync(p.file));
});

test("a move is refused when the file is gone", async () => {
  const p = project();
  assert.equal(await moveToArchive(p.root, candidate(p.mtime, { path: "docs/none.md" })), false);
});

test("a move is refused when the destination already exists", async () => {
  const p = project();
  fs.mkdirSync(path.join(p.root.fsPath, "docs", "archive"));
  fs.writeFileSync(path.join(p.root.fsPath, "docs", "archive", "old.md"), "taken");
  assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  assert.equal(fs.readFileSync(path.join(p.root.fsPath, "docs", "archive", "old.md"), "utf8"), "taken");
});

test("a move the owner does not confirm leaves the file alone", async () => {
  const p = project();
  // The stub's warning dialog answers with no choice, which is a cancel.
  assert.equal(await moveToArchive(p.root, candidate(p.mtime)), false);
  assert.ok(fs.existsSync(p.file));
});

// Hand-off host layer: settings, saving the files and the four ways to deliver.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_TERMINAL_COMMAND, joinHandoffs } from "../../board/handoff";
import { HandoffFiles, deliver, readHandoffSettings, saveHandoff } from "../../commands/boardHandoff";
import { stub, tmpDir } from "./hostHelpers";

const SECTION = "saropaWorkspace.releaseBoard.handoff";
const term = vscode as unknown as { __terminals(): ReadonlyArray<{ options: { name?: string; cwd?: unknown }; sentTexts: string[] }> };
const settings = { terminalCommand: DEFAULT_TERMINAL_COMMAND, copyMode: "referral" as const };

afterEach(() => stub.__resetConfig());

const files = (root: string, id = "2026-10-30T10-04-12-app-fix"): HandoffFiles => ({ root: vscode.Uri.file(root), id, markdown: "# MD\n", json: '{"a":1}\n' });
const dirOf = (root: string): string => path.join(root, ".saropa", "handoff");

test("settings: defaults, valid values and bad values", () => {
  assert.deepEqual(readHandoffSettings(), { terminalCommand: DEFAULT_TERMINAL_COMMAND, copyMode: "referral" });
  stub.__setConfig(SECTION, "terminalCommand", "agent {id}");
  stub.__setConfig(SECTION, "copyMode", "full");
  assert.deepEqual(readHandoffSettings(), { terminalCommand: "agent {id}", copyMode: "full" });
  stub.__setConfig(SECTION, "terminalCommand", "   ");
  stub.__setConfig(SECTION, "copyMode", "loud");
  assert.deepEqual(readHandoffSettings(), { terminalCommand: DEFAULT_TERMINAL_COMMAND, copyMode: "referral" });
});

test("saveHandoff writes the .md, .json and a .gitignore of *", async () => {
  const root = tmpDir();
  await saveHandoff(files(root));
  const dir = dirOf(root);
  assert.equal(fs.readFileSync(path.join(dir, "2026-10-30T10-04-12-app-fix.md"), "utf8"), "# MD\n");
  assert.equal(fs.readFileSync(path.join(dir, "2026-10-30T10-04-12-app-fix.json"), "utf8"), '{"a":1}\n');
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), "*\n");
});

test("saveHandoff keeps only the newest 20 hand-offs", async () => {
  const root = tmpDir();
  const ids = Array.from({ length: 22 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}T10-00-00-app-fix`);
  for (const id of ids) {
    await saveHandoff(files(root, id));
  }
  const left = fs.readdirSync(dirOf(root)).filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")).sort();
  assert.deepEqual(left, ids.slice(2));
  assert.equal(fs.readdirSync(dirOf(root)).filter((n) => n.endsWith(".json")).length, 20);
  assert.ok(fs.existsSync(path.join(dirOf(root), ".gitignore")));
});

test("deliver save: saved word and tip, nothing copied", async () => {
  const root = tmpDir();
  await vscode.env.clipboard.writeText("untouched");
  const r = await deliver("save", [files(root)], "md", settings);
  assert.ok(r.word.length > 0);
  assert.ok(r.tip.length > 0);
  assert.equal(await vscode.env.clipboard.readText(), "untouched");
  assert.ok(fs.existsSync(path.join(dirOf(root), "2026-10-30T10-04-12-app-fix.md")));
});

test("deliver copy: the referral line for md and json", async () => {
  const root = tmpDir();
  await deliver("copy", [files(root)], "md", settings);
  assert.equal(await vscode.env.clipboard.readText(), "Read .saropa/handoff/2026-10-30T10-04-12-app-fix.md and action it.");
  await deliver("copy", [files(root)], "json", settings);
  assert.equal(await vscode.env.clipboard.readText(), "Read .saropa/handoff/2026-10-30T10-04-12-app-fix.json and action it.");
});

test("deliver copy with copyMode full copies the document; copyFull always does", async () => {
  const root = tmpDir();
  await deliver("copy", [files(root)], "md", { ...settings, copyMode: "full" });
  assert.equal(await vscode.env.clipboard.readText(), "# MD\n");
  await deliver("copy", [files(root)], "json", { ...settings, copyMode: "full" });
  assert.equal(await vscode.env.clipboard.readText(), '{"a":1}\n');
  await deliver("copyFull", [files(root)], "md", settings);
  assert.equal(await vscode.env.clipboard.readText(), "# MD\n");
});

test("deliver terminal: a terminal in the root gets the command with the id filled", async () => {
  const root = tmpDir();
  const before = term.__terminals().length;
  await deliver("terminal", [files(root)], "md", { ...settings, terminalCommand: 'agent "{id}"' });
  const made = term.__terminals().slice(before);
  assert.equal(made.length, 1);
  assert.equal((made[0].options.cwd as { fsPath: string }).fsPath, root);
  assert.deepEqual(made[0].sentTexts, ['agent "2026-10-30T10-04-12-app-fix"']);
});

test("deliver with two projects: every file saved in its own folder, one referral line listing all, terminal in the first folder", async () => {
  const a = tmpDir();
  const b = tmpDir();
  const fa = files(a, "2026-10-30T10-04-12-a-fix");
  const fb = files(b, "2026-10-30T10-04-12-b-fix");
  await deliver("copy", [fa, fb], "md", settings);
  assert.ok(fs.existsSync(path.join(dirOf(a), "2026-10-30T10-04-12-a-fix.md")));
  assert.ok(fs.existsSync(path.join(dirOf(b), "2026-10-30T10-04-12-b-fix.md")));
  const line = await vscode.env.clipboard.readText();
  const rel = path.posix.relative(vscode.Uri.file(a).path, vscode.Uri.file(b).path);
  assert.equal(line, `Read .saropa/handoff/2026-10-30T10-04-12-a-fix.md and ${rel}/.saropa/handoff/2026-10-30T10-04-12-b-fix.md and action them.`);
  const before = term.__terminals().length;
  await deliver("terminal", [fa, fb], "md", settings);
  const made = term.__terminals().slice(before);
  assert.equal((made[0].options.cwd as { fsPath: string }).fsPath, a);
  assert.ok(made[0].sentTexts[0].includes("a-fix.md") && made[0].sentTexts[0].includes("b-fix.md"), made[0].sentTexts[0]);
});

test("joinHandoffs: one JSON document for several projects, one document unchanged, Markdown joined", async () => {
  const a = { markdown: "# A\n", json: '{"id":"a"}\n' };
  const b = { markdown: "# B\n", json: '{"id":"b"}\n' };
  assert.equal(joinHandoffs([a], "json"), a.json);
  assert.deepEqual(JSON.parse(joinHandoffs([a, b], "json")), { projects: [{ id: "a" }, { id: "b" }] });
  assert.equal(joinHandoffs([a, b], "md"), "# A\n\n# B\n");
  await deliver("copyFull", [files(tmpDir(), "x-a"), files(tmpDir(), "x-b")], "json", settings);
  assert.deepEqual(JSON.parse(await vscode.env.clipboard.readText()), { projects: [{ a: 1 }, { a: 1 }] });
});

test("saveHandoff retention ignores files that are not hand-offs", async () => {
  const root = tmpDir();
  const ids = Array.from({ length: 22 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}T10-00-00-app-fix`);
  fs.mkdirSync(dirOf(root), { recursive: true });
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(dirOf(root), `notes${i}.md`), "x");
  }
  for (const id of ids) {
    await saveHandoff(files(root, id));
  }
  assert.equal(fs.readdirSync(dirOf(root)).filter((n) => n.startsWith("notes")).length, 30);
  assert.equal(fs.readdirSync(dirOf(root)).filter((n) => n.startsWith("2026")).length, 40);
});

// Hand-off view layer: one document per project, one build shared by preview and actions.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { buildBoard } from "../../board/boardModel";
import { BoardConfig, Classified } from "../../board/types";
import { BoardRun } from "../../commands/releaseBoardCommands";
import { handoffAct, handoffDoc } from "../../views/boardHandoff";
import { tmpDir } from "./hostHelpers";

const a = tmpDir();
const b = tmpDir();
const cfg: BoardConfig = {
  version: 1,
  ignore: [],
  ruleSets: {},
  projects: [
    { id: "app", name: "App", path: vscode.Uri.file(a).toString(), roots: [], ruleSets: [] },
    { id: "lib", name: "Lib", path: vscode.Uri.file(b).toString(), roots: [], ruleSets: [] },
  ],
};
const row = (project: string, p: string): Classified => ({ project, path: p, status: "amber", kind: "owner action", note: "" });
const model = buildBoard(cfg, [row("app", "lib/screens/home/home_page.dart"), row("lib", "d.md")], undefined, true, undefined, undefined, {}, {});
const run = { cfg } as unknown as BoardRun;
const req = { scope: { kind: "board" as const }, task: "fix" as const, format: "md" as const };
const dirOf = (root: string): string => path.join(root, ".saropa", "handoff");

test("a two-project JSON preview is one valid document with a document per project", () => {
  const posts: Array<Record<string, unknown>> = [];
  handoffDoc((m) => void posts.push(m as Record<string, unknown>), model, run, { ...req, format: "json" as const });
  const parsed = JSON.parse(String(posts[0].text)) as { projects: Array<{ schema: string }> };
  assert.equal(parsed.projects.length, 2);
  assert.ok(parsed.projects.every((p) => p.schema === "saropa.releaseBoard.handoff/1"));
});

test("a board hand-off writes one document per project, each in its own folder, and copies one line listing both", async () => {
  const posts: Array<Record<string, unknown>> = [];
  const post = (m: unknown): void => void posts.push(m as Record<string, unknown>);
  handoffDoc(post, model, run, req);
  const doc = posts[0];
  assert.equal(doc.count, 2);
  assert.ok((doc.avail as Array<{ scope: string }>).some((x) => x.scope === "board"));
  await handoffAct(post, model, run, req, "copy");
  const ma = fs.readdirSync(dirOf(a)).filter((n) => n.endsWith(".md"));
  const mb = fs.readdirSync(dirOf(b)).filter((n) => n.endsWith(".md"));
  assert.equal(ma.length, 1);
  assert.equal(mb.length, 1);
  assert.ok(ma[0].includes("-app-fix") && mb[0].includes("-lib-fix"));
  assert.ok(fs.readFileSync(path.join(dirOf(a), ma[0]), "utf8").includes("lib/screens/home/home_page.dart"));
  assert.ok(!fs.readFileSync(path.join(dirOf(a), ma[0]), "utf8").includes("d.md"));
  const line = await vscode.env.clipboard.readText();
  assert.ok(line.startsWith(`Read .saropa/handoff/${ma[0]} and `) && line.includes(mb[0]) && line.endsWith("and action them."), line);
  // The same request again reuses the same files (same ids), and the preview text is what was saved.
  await handoffAct(post, model, run, req, "save");
  assert.deepEqual(fs.readdirSync(dirOf(a)).filter((n) => n.endsWith(".md")), ma);
  assert.equal(doc.text, fs.readFileSync(path.join(dirOf(a), ma[0]), "utf8") + "\n" + fs.readFileSync(path.join(dirOf(b), mb[0]), "utf8"));
});

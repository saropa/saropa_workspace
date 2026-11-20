// The group heading dialogs (Rename, Emoji, Color, Merge with, New tag from this group): what each asks, what a
// cancel leaves untouched, and what a confirmed answer writes to the rules file.

import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BoardItem, GroupView } from "../../board/boardModel";
import { editGroupLook } from "../../views/boardGroupLook";
import { editGroupOp } from "../../views/boardGroupOps";
import { __resetHandlers, __setInputHandler, __setPickHandler } from "../_stub/vscode";
import { stub, tmpDir } from "./hostHelpers";

const vs = vscode as unknown as { __infoMessages(): readonly string[]; __resetInfo(): void };

beforeEach(() => stub.__resetConfig());
afterEach(() => {
  __resetHandlers();
  stub.__resetWarnings();
  stub.__setWarningAnswer(() => undefined);
  stub.__setWorkspaceFolders(undefined);
  vs.__resetInfo();
});

// A temp workspace with no rules file yet; the dialogs create it on the first confirmed write.
function setup(): { file: string } {
  const dir = tmpDir();
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return { file: path.join(dir, ".saropa", "release-board.json") };
}
const read = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

const group = (id: string, name: string): GroupView => ({ id, name } as unknown as GroupView);
// Only the project, path, title and group matter to the dialogs.
const doc = (path: string, title: string, g: GroupView): BoardItem => ({ project: "app", path, title, group: g } as unknown as BoardItem);

const alpha = group("app:folder:alpha", "Alpha");
const beta = group("app:folder:beta", "Beta");
const items = [doc("docs/billing_one.md", "Billing one", alpha), doc("docs/billing_two.md", "Billing two", alpha), doc("docs/other.md", "Other", beta)];

test("Rename saves the trimmed name as the group's look and offers Undo", async () => {
  const { file } = setup();
  __setInputHandler(async () => "  Payments  ");
  const out = await editGroupLook("gRename", alpha);
  assert.ok(out);
  assert.ok(out.label.includes("Alpha"), "the Undo text names the group acted on");
  const groups = (read(file).organize as { groups: Record<string, { name: string }> }).groups;
  assert.equal(groups["app:folder:alpha"].name, "Payments");
});

test("canceling the Rename box writes nothing", async () => {
  const { file } = setup();
  __setInputHandler(async () => undefined);
  assert.equal(await editGroupLook("gRename", alpha), undefined);
  assert.equal(fs.existsSync(file), false);
});

test("an emptied Emoji box removes the emoji and keeps the name set earlier", async () => {
  const { file } = setup();
  __setInputHandler(async () => "Payments");
  await editGroupLook("gRename", alpha);
  __setInputHandler(async () => "🚀");
  await editGroupLook("gEmoji", alpha);
  __setInputHandler(async () => "   ");
  await editGroupLook("gEmoji", alpha);
  const groups = (read(file).organize as { groups: Record<string, { name?: string; emoji?: string }> }).groups;
  assert.equal(groups["app:folder:alpha"].name, "Payments");
  assert.equal(groups["app:folder:alpha"].emoji, undefined);
});

test("Back to automatic drops the group's look without asking anything", async () => {
  const { file } = setup();
  __setInputHandler(async () => "Payments");
  await editGroupLook("gRename", alpha);
  __setInputHandler(async () => assert.fail("no box is raised for Back to automatic"));
  assert.ok(await editGroupLook("gAuto", alpha));
  const organize = read(file).organize as { groups?: Record<string, unknown> } | undefined;
  assert.equal(organize?.groups?.["app:folder:alpha"], undefined);
});

test("the Rename box refuses an empty name before any write", async () => {
  setup();
  let message: string | undefined;
  __setInputHandler(async (opts) => {
    message = opts?.validateInput?.("   ");
    return undefined;
  });
  await editGroupLook("gRename", alpha);
  assert.ok(message, "a blank name is refused by the box");
});

test("Merge with lists only the other groups of the project and assigns every member to the pick", async () => {
  const { file } = setup();
  let offered: Array<{ label: string }> = [];
  __setPickHandler(async (list) => {
    offered = list as Array<{ label: string }>;
    return list[0];
  });
  const out = await editGroupOp("gMerge", items, items[0]);
  assert.ok(out);
  assert.deepEqual(offered.map((o) => o.label), ["Beta"]);
  const assign = (read(file).organize as { assign: Array<{ path: string; group: string }> }).assign;
  assert.deepEqual(assign.map((a) => [a.path, a.group]), [["docs/billing_one.md", "app:folder:beta"], ["docs/billing_two.md", "app:folder:beta"]]);
});

test("Merge with on the only group says so and writes nothing", async () => {
  const { file } = setup();
  __setPickHandler(async () => assert.fail("no pick is raised when there is no other group"));
  assert.equal(await editGroupOp("gMerge", items.slice(0, 2), items[0]), undefined);
  assert.equal(fs.existsSync(file), false);
  assert.equal(vs.__infoMessages().length, 1, "the person is told why nothing happened");
});

test("canceling the Merge pick writes nothing", async () => {
  const { file } = setup();
  __setPickHandler(async () => undefined);
  assert.equal(await editGroupOp("gMerge", items, items[0]), undefined);
  assert.equal(fs.existsSync(file), false);
});

test("New tag from this group prefills the shared word and saves the tag under the typed name", async () => {
  const { file } = setup();
  const prefills: Array<string | undefined> = [];
  __setInputHandler(async (opts) => {
    prefills.push(opts?.value);
    return opts?.value === "Alpha" ? "Billing docs" : opts?.value;
  });
  const out = await editGroupOp("gTag", items, items[0]);
  assert.ok(out);
  assert.equal(prefills[1], "billing", "the second box starts with the words the group shares");
  const add = (read(file).organize as { tags: { add: Array<{ label: string; patterns: string[] }> } }).tags.add;
  const made = add.find((t) => t.label === "Billing docs");
  assert.deepEqual(made?.patterns, ["billing"]);
});

test("New tag from this group refuses a words box with a character the tag editor would not accept", async () => {
  setup();
  let message: string | undefined;
  __setInputHandler(async (opts) => {
    if (opts?.value !== "Alpha") {
      message = opts?.validateInput?.("bad!word");
      return undefined;
    }
    return "Name";
  });
  await editGroupOp("gTag", items, items[0]);
  assert.ok(message);
});

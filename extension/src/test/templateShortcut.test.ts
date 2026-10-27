// Unit tests for "use as template": the new file is a copy of the shortcut's file
// with the old name replaced by the new one in every case style, and named in the
// source file's own naming style. Runs against real files in a temp folder.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import { Uri, __setInputHandler, __resetHandlers } from "./_stub/vscode";
import { useAsTemplate } from "../commands/templateShortcut";
import type { ShortcutStore } from "../model/shortcutStore";
import type { Shortcut } from "../model/shortcut";

const win = vscode.window as unknown as Record<string, unknown>;
let dir: string;
let info: string[];
let warn: string[];
let opened: string[];
const saved: Record<string, unknown> = {};

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "tpl-")).replace(/\\/g, "/");
  info = [];
  warn = [];
  opened = [];
  saved.info = win.showInformationMessage;
  saved.warn = win.showWarningMessage;
  saved.show = win.showTextDocument;
  win.showInformationMessage = (m: string): Promise<undefined> => (info.push(m), Promise.resolve(undefined));
  win.showWarningMessage = (m: string): Promise<undefined> => (warn.push(m), Promise.resolve(undefined));
  win.showTextDocument = async (u: Uri): Promise<void> => void opened.push(u.fsPath);
});

afterEach(() => {
  win.showInformationMessage = saved.info;
  win.showWarningMessage = saved.warn;
  win.showTextDocument = saved.show;
  __resetHandlers();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

function source(name: string, body: string): { store: ShortcutStore; shortcut: Shortcut } {
  nodeFs.writeFileSync(`${dir}/${name}`, body);
  const shortcut = { id: "t", path: name, scope: "project" } as Shortcut;
  const store = { resolveUri: () => Uri.file(`${dir}/${name}`) } as unknown as ShortcutStore;
  return { store, shortcut };
}

const read = (name: string): string => nodeFs.readFileSync(`${dir}/${name}`, "utf8");

test("a Pascal-case source is renamed in every case style inside the content", async () => {
  const body = "class UserCard {}\nconst userCard = 1;\nconst USER_CARD = 2;\nfile: user_card, user-card\n";
  const { store, shortcut } = source("UserCard.ts", body);
  __setInputHandler(async () => "order list");
  await useAsTemplate(store, shortcut);
  assert.equal(read("OrderList.ts"), "class OrderList {}\nconst orderList = 1;\nconst ORDER_LIST = 2;\nfile: order_list, order-list\n");
  assert.deepEqual(opened, [`${dir}/OrderList.ts`]);
  assert.equal(info[0], "Created OrderList.ts from UserCard.ts.");
});

test("the new file name follows the source file's own naming style", async () => {
  for (const [name, expected] of [
    ["user_card.py", "order_list.py"],
    ["user-card.js", "order-list.js"],
    ["userCard.js", "orderList.js"],
  ] as const) {
    const { store, shortcut } = source(name, "x");
    __setInputHandler(async () => "OrderList");
    await useAsTemplate(store, shortcut);
    assert.ok(nodeFs.existsSync(`${dir}/${expected}`), expected);
  }
});

test("unrelated text is left alone and the source is not modified", async () => {
  const { store, shortcut } = source("user_card.py", "import usercardx\nuser_card()\n");
  __setInputHandler(async () => "order");
  await useAsTemplate(store, shortcut);
  assert.equal(read("order.py"), "import usercardx\norder()\n");
  assert.equal(read("user_card.py"), "import usercardx\nuser_card()\n");
});

test("an existing target is never overwritten", async () => {
  const { store, shortcut } = source("user_card.py", "new");
  nodeFs.writeFileSync(`${dir}/order.py`, "keep me");
  __setInputHandler(async () => "order");
  await useAsTemplate(store, shortcut);
  assert.equal(read("order.py"), "keep me");
  assert.match(warn[0], /order\.py/);
});

test("cancelling, or typing only separators, creates nothing", async () => {
  const { store, shortcut } = source("user_card.py", "x");
  __setInputHandler(async () => undefined);
  await useAsTemplate(store, shortcut);
  __setInputHandler(async () => " - _ ");
  await useAsTemplate(store, shortcut);
  assert.deepEqual(nodeFs.readdirSync(dir), ["user_card.py"]);
});

test("a non-file or unresolvable shortcut is refused", async () => {
  const shell = { id: "s", path: "", scope: "project", action: { kind: "shell", shellCommand: "ls" } } as Shortcut;
  await useAsTemplate({} as ShortcutStore, shell);
  assert.equal(warn.length, 1);
  const gone = { id: "g", path: "gone.ts", scope: "project" } as Shortcut;
  await useAsTemplate({ resolveUri: () => undefined } as unknown as ShortcutStore, gone);
  assert.equal(warn.length, 2);
});

// Which projects count as active now: a live or recent, unarchived chat inside the project folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_WINDOW_MS, activeProjects } from "../../board/activeNow";
import { activePill, noticeBar, pollPill } from "../../board/boardHtmlChats";
import { renderBoard } from "../../board/boardHtml";
import { buildBoard } from "../../board/boardModel";
import { topBar } from "../../board/boardHtmlHeader";
import { BoardConfig } from "../../board/types";
import { strings } from "../../views/boardStrings";

const NOW = 10_000_000;
const projects = [
  { id: "app", folder: "/work/app" },
  { id: "lib", folder: "/work/lib/" }
];
const chat = (folder: string, ago: number, extra: object = {}) => ({ folder, last: NOW - ago, archived: false, ...extra });

test("a chat used within the window in the project folder or below it marks the project", () => {
  assert.deepEqual(activeProjects([chat("/work/app", 1000)], projects, NOW), ["app"]);
  assert.deepEqual(activeProjects([chat("/work/app/.claude/worktrees/x", 1000), chat("/work/lib", 0)], projects, NOW), ["app", "lib"]);
  assert.deepEqual(activeProjects([chat("C:\\work\\app", 1000)], [{ id: "w", folder: "C:/work/app" }], NOW), ["w"]);
});

test("old, archived and unrelated chats do not count; a live state does, however old", () => {
  assert.deepEqual(activeProjects([chat("/work/app", ACTIVE_WINDOW_MS + 1)], projects, NOW), []);
  assert.deepEqual(activeProjects([chat("/work/app", 0, { archived: true })], projects, NOW), []);
  assert.deepEqual(activeProjects([chat("/work/application", 0)], projects, NOW), [], "a folder with the same prefix is another folder");
  assert.deepEqual(activeProjects([chat("/work/app", ACTIVE_WINDOW_MS * 9, { state: "waiting" })], projects, NOW), ["app"]);
  assert.deepEqual(activeProjects([], projects, NOW), []);
});

const t = strings();
const cfg: BoardConfig = { version: 1, ignore: [], ruleSets: {}, projects: [{ id: "app", name: "App <b>", path: "app", roots: ["docs"], ruleSets: [] }] };

test("the pill, the pause and play pill and the notice bar are drawn only when asked and are escaped", () => {
  assert.equal(activePill(false, t), "");
  assert.ok(activePill(true, t).includes("Active now") && activePill(true, t).includes("title="));
  assert.equal(pollPill(undefined, t), "");
  assert.ok(pollPill(false, t).includes("Pause") && pollPill(false, t).includes('aria-label="Pause'));
  assert.ok(pollPill(true, t).includes("Resume"));
  assert.equal(noticeBar(undefined), "");
  const bar = noticeBar('<img src=x onerror="1">');
  assert.ok(bar.includes('role="status"') && !bar.includes("<img"));
});

test("the page shows the pill on the active project only, the poll pill with the state, and the notice", () => {
  const m = buildBoard(cfg, [], undefined, true);
  const none = renderBoard(m, t, "n", 1, { groupBy: "project" });
  assert.ok(!none.includes("Active now") && !none.includes('<button class="sec" data-chat-poll') && !none.includes('id="notice"'));
  const on = renderBoard(m, t, "n", 1, { groupBy: "project", chat: { active: ["app"], paused: false }, notice: "Gone" });
  assert.equal(on.match(/class="go active"/g)?.length, 1);
  assert.ok(on.includes("data-chat-poll") && on.includes('id="notice"'));
  const other = renderBoard(m, t, "n", 1, { groupBy: "none", chat: { active: ["lib"], paused: true } });
  assert.ok(!other.includes('class="go active"') && other.includes("Resume"));
  assert.ok(topBar(m, t, "all", "", undefined, true).includes("data-chat-poll"));
});

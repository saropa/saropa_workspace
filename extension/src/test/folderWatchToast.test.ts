// Tests for the folder-watch and repo-watch toasts: the wording for new, changed and
// mixed results (live and startup), the file-list cap, and what the Open button does.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { __externalOpens, __recordedCommands, __resetEnv, __resetRecordedCommands } from "./_stub/vscode";
import { toastFolderDelta, toastRepoItems } from "../exec/folderWatchToast";
import type { FolderWatch } from "../model/folderWatch";
import type { GitHubWatchItem } from "../github/githubTypes";

const win = vscode.window as unknown as Record<string, unknown>;
let shown: Array<{ message: string; actions: string[] }>;
let answer: string | undefined;
let opened: string[];
let openFails: boolean;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  shown = [];
  opened = [];
  answer = undefined;
  openFails = false;
  __resetEnv();
  __resetRecordedCommands();
  saved.info = win.showInformationMessage;
  saved.doc = win.showTextDocument;
  win.showInformationMessage = (message: string, ...actions: string[]): Promise<string | undefined> => {
    shown.push({ message, actions });
    return Promise.resolve(answer);
  };
  win.showTextDocument = async (uri: vscode.Uri): Promise<void> => {
    if (openFails) {
      throw new Error("cannot open");
    }
    opened.push(uri.fsPath);
  };
});
afterEach(() => {
  win.showInformationMessage = saved.info;
  win.showTextDocument = saved.doc;
});

const watch = (extra: Partial<FolderWatch> = {}): FolderWatch =>
  ({ id: "w", target: "/p/dir", isFile: false, mode: "new", enabled: true, ...extra }) as FolderWatch;

test("new files are listed by base name with a count and the label", async () => {
  await toastFolderDelta(watch(), { added: ["a/x.txt", "y.txt"], changed: [] }, false, "dir");
  assert.deepEqual(shown, [{ message: "2 new in dir: x.txt, y.txt", actions: ["Open"] }]);
});

test("a startup scan says the files arrived while the user was away", async () => {
  await toastFolderDelta(watch(), { added: ["x.txt"], changed: [] }, true, "dir");
  assert.equal(shown[0].message, "1 new in dir while you were away: x.txt");
});

test("changed files, live and at startup", async () => {
  await toastFolderDelta(watch(), { added: [], changed: ["c.txt"] }, false, "dir");
  await toastFolderDelta(watch(), { added: [], changed: ["c.txt"] }, true, "dir");
  assert.deepEqual(shown.map((s) => s.message), ["1 changed in dir: c.txt", "1 changed in dir while you were away: c.txt"]);
});

test("new and changed files together get one mixed message, added first", async () => {
  await toastFolderDelta(watch(), { added: ["n.txt"], changed: ["c1.txt", "c2.txt"] }, false, "dir");
  await toastFolderDelta(watch(), { added: ["n.txt"], changed: ["c.txt"] }, true, "dir");
  assert.deepEqual(shown.map((s) => s.message), [
    "1 new, 2 changed in dir: n.txt, c1.txt, c2.txt",
    "1 new, 1 changed in dir while you were away: n.txt, c.txt",
  ]);
});

test("more than five files are cut to five with a count of the rest", async () => {
  const added = ["1", "2", "3", "4", "5", "6", "7"].map((n) => `f${n}.txt`);
  await toastFolderDelta(watch(), { added, changed: [] }, false, "dir");
  assert.equal(shown[0].message, "7 new in dir: f1.txt, f2.txt, f3.txt, f4.txt, f5.txt +2 more");
});

test("Open shows the first file inside the watched folder", async () => {
  answer = "Open";
  await toastFolderDelta(watch(), { added: ["sub/first.txt", "second.txt"], changed: [] }, false, "dir");
  assert.deepEqual(opened, ["/p/dir/sub/first.txt"]);
});

test("Open on a single watched file shows that file", async () => {
  answer = "Open";
  await toastFolderDelta(watch({ isFile: true, target: "/p/only.log" }), { added: [], changed: ["only.log"] }, false, "only.log");
  assert.deepEqual(opened, ["/p/only.log"]);
});

test("dismissing the toast opens nothing", async () => {
  await toastFolderDelta(watch(), { added: ["x.txt"], changed: [] }, false, "dir");
  assert.deepEqual(opened, []);
  assert.deepEqual(__recordedCommands(), []);
});

test("when the file cannot be opened it is revealed in the Explorer instead", async () => {
  answer = "Open";
  openFails = true;
  await toastFolderDelta(watch(), { added: ["x.txt"], changed: [] }, false, "dir");
  assert.deepEqual(__recordedCommands().map((c) => [c.command, (c.args[0] as vscode.Uri).fsPath]), [["revealInExplorer", "/p/dir/x.txt"]]);
});

function item(key: string, kind: "issue" | "pr", number: number, updatedAt: string, title = `T${number}`): GitHubWatchItem {
  return { key, kind, number, title, updatedAt, htmlUrl: `https://example.test/${number}` } as GitHubWatchItem;
}

test("repo toasts say issues, pull requests or both, naming the items", async () => {
  const issue = item("i1", "issue", 1, "2026-01-01T00:00:00Z", "Bug");
  const pr = item("p2", "pr", 2, "2026-01-02T00:00:00Z", "Fix");
  await toastRepoItems({ added: ["i1"], changed: [] }, [issue, pr], "o/r");
  await toastRepoItems({ added: ["p2"], changed: [] }, [issue, pr], "o/r");
  await toastRepoItems({ added: ["i1", "p2"], changed: [] }, [issue, pr], "o/r");
  assert.deepEqual(shown.map((s) => s.message), [
    "1 new issue(s) in o/r: #1 Bug",
    "1 new pull request(s) in o/r: #2 Fix",
    "1 new issue(s), 1 new pull request(s) in o/r: #1 Bug, #2 Fix",
  ]);
});

test("a repo delta whose keys match no fetched item shows nothing", async () => {
  await toastRepoItems({ added: ["gone"], changed: [] }, [item("i1", "issue", 1, "2026-01-01T00:00:00Z")], "o/r");
  assert.deepEqual(shown, []);
});

test("Open on a repo toast opens the most recently updated new item in the browser", async () => {
  answer = "Open";
  const older = item("i1", "issue", 1, "2026-01-01T00:00:00Z");
  const newer = item("p2", "pr", 2, "2026-03-01T00:00:00Z");
  await toastRepoItems({ added: ["i1", "p2"], changed: [] }, [older, newer], "o/r");
  assert.deepEqual(__externalOpens(), ["https://example.test/2"]);
});

test("dismissing a repo toast opens nothing", async () => {
  await toastRepoItems({ added: ["i1"], changed: [] }, [item("i1", "issue", 1, "2026-01-01T00:00:00Z")], "o/r");
  assert.deepEqual(__externalOpens(), []);
});

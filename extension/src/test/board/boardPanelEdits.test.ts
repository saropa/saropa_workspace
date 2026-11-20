// The write-with-Undo handlers of the board panel (views/boardPanelEdits.ts), driven the way the page drives them: a
// message posted to the real panel opened through openBoard. Covers a message from an old page (stale rev), a second
// write while one is running, Undo restoring the file and taking the bar away, and a half-finished Undo that blocks
// new writes. Every wait is on a result (the file written, the bar shown, a message posted), never on a count of turns.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { openBoard } from "../../views/boardPanel";
import { UNDO_PENDING, busyMessage } from "../../views/boardBusy";
import { l10n } from "../../i18n/l10n";
import { __infoMessages, __lastWebviewPanel, __resetWebviewPanels } from "../_stub/vscode";
import { flushEvents, settle } from "../settle";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => {
  __resetWebviewPanels();
  stub.__resetConfig();
  // Also clears the recorded info and warning messages, so one test's notices never satisfy another's wait.
  stub.__resetWarnings();
  stub.__setWorkspaceFolders(undefined);
});

type Panel = NonNullable<ReturnType<typeof __lastWebviewPanel>>;

// The page stamps every message with the number of the paint it came from; the host ignores any other number.
const revOf = (panel: Panel): number => Number(/const REV=(\d+)/.exec(panel.webview.html)?.[1]);
const rulesOf = (dir: string): string => path.join(dir, ".saropa", "release-board.json");
const ORIGINAL = '{\n    "version": 1\n}\n';

// A workspace with one plan document (row id 0) and, when `withRules` is set, a rules file with odd indentation so an
// exact restore can be told from a re-serialized one.
function workspace(withRules: boolean): string {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "PLAN_ONE.md"), "# Plan one\n\nStatus: in progress\n");
  if (withRules) {
    fs.mkdirSync(path.join(dir, ".saropa"));
    fs.writeFileSync(rulesOf(dir), ORIGINAL);
  }
  stub.__setWorkspaceFolders([{ uri: vscode.Uri.file(dir), name: "app", index: 0 }]);
  return dir;
}

// Opens the real board and waits until the row is painted. The scan is finished when openBoard returns; the wait is
// for the paint that carries the row, which later paints (outside data, live signals) may replace with a newer rev.
async function openPanel(dir: string): Promise<Panel> {
  await openBoard(contextIn(dir));
  const panel = __lastWebviewPanel();
  assert.ok(panel, "a panel was created");
  await settle(() => panel.webview.html.includes("Plan one") && /const REV=\d+/.test(panel.webview.html));
  return panel;
}

// Posts a message as the page would, with the rev of the paint on screen now plus `revShift`; returns the rev used.
function send(panel: Panel, message: Record<string, unknown>, revShift = 0): number {
  const rev = revOf(panel) + revShift;
  panel.webview.__receiveFromClient({ ...message, rev });
  return rev;
}

// How many times the host told the page something that means "your request was not taken": a notice, or an Undo
// button released again. A refused request is sent again, because the page would let the person press it again.
const refusals = (panel: Panel): number => __infoMessages().length + panel.webview.postedMessages.filter((m) => (m as { type?: string }).type === "undoOn").length;

// Sends a message and waits for `done`. If the host refused it (busy, or a repaint made its rev stale) the message is
// sent again with the new rev, so the wait is for the result and not for any amount of time.
async function sendUntil(panel: Panel, message: Record<string, unknown>, done: () => boolean): Promise<void> {
  let sentRev = send(panel, message);
  let seen = refusals(panel);
  await settle(() => {
    if (done()) {
      return true;
    }
    if (refusals(panel) > seen || revOf(panel) !== sentRev) {
      seen = refusals(panel);
      sentRev = send(panel, message);
    }
    return false;
  });
}

// Watches every write of the rules file's temporary copy. `hold()` makes the next ones wait until `release()`, so a
// test can look at the panel while a write is in flight; `texts` is every text written, in order.
function watchRulesWrites(): { texts: string[]; hold(): void; release(): void; reached(): boolean; restore(): void } {
  const api = vscode.workspace.fs as unknown as { writeFile: (u: vscode.Uri, b: Uint8Array) => Promise<void> };
  const orig = api.writeFile;
  const texts: string[] = [];
  let gate: Promise<void> | undefined;
  let open: () => void = () => undefined;
  let reached = false;
  api.writeFile = async function (this: unknown, u: vscode.Uri, b: Uint8Array): Promise<void> {
    // Only the rules file's temporary copy (named "release-board.json.<pid>-<n>.tmp") is watched.
    if (path.basename(u.fsPath).startsWith("release-board.json")) {
      reached = true;
      texts.push(Buffer.from(b).toString("utf8"));
      if (gate) {
        await gate;
      }
    }
    return orig.call(this, u, b);
  };
  return {
    texts,
    hold: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => open(),
    reached: () => reached,
    restore: () => {
      api.writeFile = orig;
    },
  };
}

const severityOf = (dir: string): unknown => (JSON.parse(fs.readFileSync(rulesOf(dir), "utf8")) as { severityOverrides?: Array<{ severity: string }> }).severityOverrides?.map((s) => s.severity);
const barShown = (panel: Panel): boolean => panel.webview.html.includes('id="undo"');
const posted = (panel: Panel, type: string): unknown[] => panel.webview.postedMessages.filter((m) => (m as { type?: string }).type === type);

// ---- A message from an old page is ignored ----

test("a row-menu message carrying an old rev, a future rev or no rev writes nothing, and the current rev writes once", async () => {
  const dir = workspace(false);
  const panel = await openPanel(dir);
  const writes = watchRulesWrites();
  try {
    send(panel, { type: "rowMenu", act: "sev:high", id: 0 }, -1);
    send(panel, { type: "rowMenu", act: "sev:high", id: 0 }, 1);
    panel.webview.__receiveFromClient({ type: "rowMenu", act: "sev:high", id: 0 });
    // The current message only runs if no ignored one is holding the board busy; if one was taken, "high" would be
    // written first and the recorded writes below would hold two texts.
    await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => fs.existsSync(rulesOf(dir)));
  } finally {
    writes.restore();
  }
  assert.equal(writes.texts.length, 1, "only the message with the current rev was written");
  assert.deepEqual(severityOf(dir), ["low"]);
});

test("a message with the current rev but a made-up row id releases the row and writes nothing", async () => {
  const dir = workspace(false);
  const panel = await openPanel(dir);
  const writes = watchRulesWrites();
  try {
    for (const id of [99, -1, 0.5]) {
      send(panel, { type: "rowMenu", act: "sev:low", id });
    }
    // The page marked the row pending when it sent the message; the release is the host's answer for a row it never painted.
    await settle(() => posted(panel, "clearPending").length >= 3);
  } finally {
    writes.restore();
  }
  assert.deepEqual(posted(panel, "clearPending"), [
    { type: "clearPending", id: 99 },
    { type: "clearPending", id: -1 },
    { type: "clearPending", id: 0.5 },
  ]);
  assert.equal(writes.texts.length, 0);
  assert.equal(fs.existsSync(rulesOf(dir)), false);
});

test("a menu entry that is not a change (unknown severity, status out of range) releases the row and writes nothing", async () => {
  const dir = workspace(false);
  const panel = await openPanel(dir);
  const writes = watchRulesWrites();
  try {
    for (const act of ["sev:bogus", "status:999", "unknown"]) {
      send(panel, { type: "rowMenu", act, id: 0 });
    }
    await settle(() => posted(panel, "clearPending").length >= 3);
  } finally {
    writes.restore();
  }
  assert.equal(writes.texts.length, 0);
  assert.equal(fs.existsSync(rulesOf(dir)), false);
});

// ---- A second write while one is running is refused ----

test("a second change while one is being written is refused with the busy notice and the row is released", async () => {
  const dir = workspace(false);
  const panel = await openPanel(dir);
  const writes = watchRulesWrites();
  writes.hold();
  try {
    // First change: it stops inside the write, so the panel is busy until release().
    await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => writes.reached());
    const busy = l10n("releaseBoard.rowMenu.busyDialog");
    // The second request is sent again when a repaint made its rev stale, until the host answers it with the notice.
    await sendUntil(panel, { type: "rowMenu", act: "sev:high", id: 0 }, () => __infoMessages().includes(busy));
    assert.ok(posted(panel, "clearPending").some((m) => (m as { id?: number }).id === 0), "the refused row is released");
    assert.equal(writes.texts.length, 1, "the refused change was never started");
  } finally {
    writes.release();
  }
  await settle(() => fs.existsSync(rulesOf(dir)));
  writes.restore();
  assert.deepEqual(severityOf(dir), ["low"], "only the first change was written");
});

test("a second Assign rule on a row is refused while a change is running", async () => {
  const dir = workspace(false);
  const panel = await openPanel(dir);
  const writes = watchRulesWrites();
  writes.hold();
  try {
    await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => writes.reached());
    const busy = l10n("releaseBoard.rowMenu.busyDialog");
    await sendUntil(panel, { type: "rowMenu", act: "assign", id: 0 }, () => __infoMessages().includes(busy));
  } finally {
    writes.release();
    await settle(() => fs.existsSync(rulesOf(dir)));
    writes.restore();
  }
  assert.deepEqual(severityOf(dir), ["low"], "no rule was assigned on top of the running change");
});

// ---- Undo restores the file and clears the bar ----

test("Undo puts the exact previous rules text back and takes the Undo bar away", async () => {
  const dir = workspace(true);
  const panel = await openPanel(dir);
  await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => fs.readFileSync(rulesOf(dir), "utf8") !== ORIGINAL);
  assert.deepEqual(severityOf(dir), ["low"]);
  // The bar is drawn by the repaint that follows the write: pressing Undo before it exists would be pressing nothing.
  await settle(() => barShown(panel));
  await sendUntil(panel, { type: "undo" }, () => fs.readFileSync(rulesOf(dir), "utf8") === ORIGINAL);
  await settle(() => !barShown(panel));
  assert.equal(fs.readFileSync(rulesOf(dir), "utf8"), ORIGINAL);
});

test("Undo of a change that created the rules file removes the file and the folder, and the bar", async () => {
  const dir = workspace(false);
  const panel = await openPanel(dir);
  await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => fs.existsSync(rulesOf(dir)));
  await settle(() => barShown(panel));
  await sendUntil(panel, { type: "undo" }, () => !fs.existsSync(path.join(dir, ".saropa")));
  await settle(() => !barShown(panel));
});

test("an Undo message with no change to undo does nothing", async () => {
  const dir = workspace(true);
  const panel = await openPanel(dir);
  const before = posted(panel, "undoOn").length;
  send(panel, { type: "undo" });
  // Nothing is written and nothing is posted, so there is no result to wait for; the check is that nothing follows.
  await flushEvents(20);
  assert.equal(fs.readFileSync(rulesOf(dir), "utf8"), ORIGINAL);
  assert.equal(posted(panel, "undoOn").length, before);
});

test("dismissing the bar takes it away for good: a later Undo message restores nothing", async () => {
  const dir = workspace(true);
  const panel = await openPanel(dir);
  await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => fs.readFileSync(rulesOf(dir), "utf8") !== ORIGINAL);
  await settle(() => barShown(panel));
  const written = fs.readFileSync(rulesOf(dir), "utf8");
  await sendUntil(panel, { type: "undoDismiss" }, () => posted(panel, "undoOff").length > 0);
  send(panel, { type: "undo" });
  await flushEvents(20);
  assert.equal(fs.readFileSync(rulesOf(dir), "utf8"), written, "the dismissed change stays");
});

// ---- A refused Undo keeps the bar and blocks new writes ----

test("an Undo refused because the file changed afterwards keeps the bar, leaves the edited file, and blocks the next change with the pending notice", async () => {
  const dir = workspace(true);
  const panel = await openPanel(dir);
  await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => fs.readFileSync(rulesOf(dir), "utf8") !== ORIGINAL);
  await settle(() => barShown(panel));
  // Someone edits the file by hand after the change: Undo must not overwrite that edit.
  const edited = '{"version":1,"edited":"by hand"}';
  fs.writeFileSync(rulesOf(dir), edited);
  // A scan still running after the write makes the host release the Undo button without trying, so the press is sent
  // again until the host really tried (its warning) and put the button back.
  await sendUntil(panel, { type: "undo" }, () => stub.__warningMessages().some((m) => m.includes("changed after that edit")));
  assert.equal(fs.readFileSync(rulesOf(dir), "utf8"), edited);
  assert.ok(barShown(panel), "the bar stays until the Undo succeeds or is dismissed");
  // The Undo is half-finished (no expiry timer), so a new change is refused with the notice that says why. A scan that
  // is still running is refused first with its own notice, so the change is sent again until the pending notice shows.
  const pending = busyMessage(UNDO_PENDING, []);
  await sendUntil(panel, { type: "rowMenu", act: "sev:high", id: 0 }, () => __infoMessages().includes(pending));
  assert.equal(fs.readFileSync(rulesOf(dir), "utf8"), edited, "the refused change wrote nothing");
});

test("a write that fails is shown as an error, offers no Undo bar and leaves the board usable", async () => {
  const dir = workspace(true);
  const panel = await openPanel(dir);
  const api = vscode.workspace.fs as unknown as { writeFile: (u: vscode.Uri, b: Uint8Array) => Promise<void> };
  const orig = api.writeFile;
  let failures = 0;
  api.writeFile = async function (this: unknown, u: vscode.Uri, b: Uint8Array): Promise<void> {
    if (path.basename(u.fsPath).startsWith("release-board.json")) {
      failures++;
      throw new Error("disk full");
    }
    return orig.call(this, u, b);
  };
  try {
    await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => failures > 0);
    // The failed row is released so the page does not keep showing it as pending.
    await settle(() => posted(panel, "clearPending").length > 0);
  } finally {
    api.writeFile = orig;
  }
  assert.equal(fs.readFileSync(rulesOf(dir), "utf8"), ORIGINAL, "the original is untouched");
  assert.ok(!barShown(panel), "nothing was written, so there is nothing to undo");
  // The guard flag was released by the failure: the same change now goes through.
  await sendUntil(panel, { type: "rowMenu", act: "sev:low", id: 0 }, () => fs.readFileSync(rulesOf(dir), "utf8") !== ORIGINAL);
  assert.deepEqual(severityOf(dir), ["low"]);
});

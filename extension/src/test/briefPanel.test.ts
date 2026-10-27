// Tests for the Morning Brief panel: single-instance reuse, the ready handshake, the path
// re-validation before a report opens, and the export actions.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as vscode from "./_stub/vscode";
import {
  Uri, __setWorkspaceFolders, __lastWebviewPanel, __resetWebviewPanels, __openedDocuments,
  __resetOpenedDocuments, __externalOpens, __resetEnv, __infoMessages, __resetInfo, __errorMessages,
  type FakeWebviewPanel,
} from "./_stub/vscode";
import { BriefPanel } from "../views/briefPanel";
import { renderBriefShell, briefUiStrings } from "../views/brief/briefShell";
import { renderBriefMarkdown, renderBriefExportHtml } from "../views/brief/briefExport";
import type { RoutineBrief } from "../exec/routineRunner";
import { settle } from "./settle";
import { l10n } from "../i18n/l10n";

let tmpDir: string;
const windowApi = vscode.window as unknown as Record<string, unknown>;
const originalSaveDialog = windowApi.showSaveDialog;
const withoutNonce = (html: string): string => html.replace(/nonce[-=]"?'?[A-Za-z0-9+/=]+/g, "nonce");

function brief(over: Partial<RoutineBrief> = {}): RoutineBrief {
  return {
    routineName: "Morning",
    generatedAt: "2026-03-04T09:00:00.000Z",
    verdict: "attention",
    attentionCount: 1,
    members: [{ label: "Lint", status: "failed", headline: "3 errors", attention: true }],
    summaryPath: "/r/summary.md",
    ...over,
  };
}

function panel(): FakeWebviewPanel {
  const p = __lastWebviewPanel();
  assert.ok(p, "a panel was created");
  return p;
}

beforeEach(() => {
  tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sw-brief-")).replace(/\\/g, "/");
  __setWorkspaceFolders([{ uri: Uri.file(tmpDir), name: "proj", index: 0 }]);
});

afterEach(() => {
  __resetWebviewPanels();
  __resetOpenedDocuments();
  __resetEnv();
  __resetInfo();
  __setWorkspaceFolders(undefined);
  windowApi.showSaveDialog = originalSaveDialog;
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

test("show creates one panel with the shell page and the brief title", () => {
  BriefPanel.show(brief());
  assert.equal(panel().viewType, "saropaWorkspace.morningBrief");
  assert.equal(panel().title, l10n("brief.title"));
  assert.equal(withoutNonce(panel().webview.html), withoutNonce(renderBriefShell()));
});

test("the ready message sends the brief and the page strings", async () => {
  const b = brief();
  BriefPanel.show(b);
  panel().webview.__receiveFromClient({ type: "ready" });
  await settle(() => panel().webview.postedMessages.length === 1);
  assert.deepEqual(panel().webview.postedMessages, [{ type: "briefData", brief: b, strings: briefUiStrings() }]);
});

test("showing again reuses the open panel and posts the new brief at once", () => {
  BriefPanel.show(brief({ routineName: "First" }));
  const first = panel();
  const second = brief({ routineName: "Second" });
  BriefPanel.show(second);
  assert.equal(panel(), first);
  assert.deepEqual(first.webview.postedMessages, [{ type: "briefData", brief: second, strings: briefUiStrings() }]);
});

test("closing the panel lets the next show create a fresh one", () => {
  BriefPanel.show(brief());
  const first = panel();
  first.dispose();
  BriefPanel.show(brief());
  assert.notEqual(panel(), first);
});

test("openReport opens a dated report inside the reports folder", async () => {
  BriefPanel.show(brief());
  const report = `${tmpDir}/reports/2026.03.04_090000_status.md`;
  panel().webview.__receiveFromClient({ type: "openReport", path: report });
  await settle(() => __openedDocuments().length === 1);
  assert.deepEqual(__openedDocuments(), [Uri.file(report).toString()]);
});

test("openReport refuses a path outside reports, a deep path and a wrong name", async () => {
  BriefPanel.show(brief());
  const bad = [
    `${tmpDir}/other/2026.03.04_090000_status.md`,
    `${tmpDir}/reports/a/b/2026.03.04_090000_status.md`,
    `${tmpDir}/reports/notes.md`,
    `${tmpDir}/reports/../2026.03.04_090000_status.md`,
    42,
    undefined,
  ];
  bad.forEach((path) => panel().webview.__receiveFromClient({ type: "openReport", path }));
  panel().webview.__receiveFromClient({ type: "ready" });
  await settle(() => panel().webview.postedMessages.length === 1);
  assert.deepEqual(__openedDocuments(), []);
});

test("messages that are not objects or have an unknown type do nothing", async () => {
  BriefPanel.show(brief());
  [null, "ready", 7, { type: "nope" }].forEach((m) => panel().webview.__receiveFromClient(m));
  panel().webview.__receiveFromClient({ type: "ready" });
  await settle(() => panel().webview.postedMessages.length === 1);
  assert.equal(panel().webview.postedMessages.length, 1);
});

test("copyMarkdown puts the Markdown export on the clipboard and says so", async () => {
  const b = brief();
  BriefPanel.show(b);
  panel().webview.__receiveFromClient({ type: "copyMarkdown" });
  await settle(() => __infoMessages().length === 1);
  assert.equal(await vscode.env.clipboard.readText(), renderBriefMarkdown(b, briefUiStrings()));
  assert.deepEqual(__infoMessages(), [l10n("brief.copied")]);
});

test("openInBrowser writes the export page named by the brief date and opens it", async () => {
  const b = brief();
  BriefPanel.show(b);
  panel().webview.__receiveFromClient({ type: "openInBrowser" });
  await settle(() => __externalOpens().length === 1);
  const file = nodePath.join(os.tmpdir(), "saropa-brief-2026-03-04.html");
  try {
    assert.equal(nodeFs.readFileSync(file, "utf8"), renderBriefExportHtml(b, briefUiStrings()));
    assert.deepEqual(__externalOpens(), [Uri.file(file).toString()]);
  } finally {
    nodeFs.rmSync(file, { force: true });
  }
});

test("saveHtml writes the export page where the save dialog points and reports the path", async () => {
  const b = brief();
  const target = `${tmpDir}/chosen.html`;
  let offered: { defaultUri?: Uri } | undefined;
  windowApi.showSaveDialog = async (opts: { defaultUri?: Uri }) => {
    offered = opts;
    return Uri.file(target);
  };
  BriefPanel.show(b);
  panel().webview.__receiveFromClient({ type: "saveHtml" });
  await settle(() => __infoMessages().length === 1);
  assert.equal(offered?.defaultUri?.fsPath, `${tmpDir}/morning-brief-2026-03-04.html`);
  assert.equal(nodeFs.readFileSync(target, "utf8"), renderBriefExportHtml(b, briefUiStrings()));
  assert.deepEqual(__infoMessages(), [l10n("brief.saved", { path: target })]);
});

test("saveHtml with the dialog canceled writes nothing and shows nothing", async () => {
  BriefPanel.show(brief());
  panel().webview.__receiveFromClient({ type: "saveHtml" });
  panel().webview.__receiveFromClient({ type: "ready" });
  await settle(() => panel().webview.postedMessages.length === 1);
  assert.deepEqual(__infoMessages(), []);
  assert.deepEqual(nodeFs.readdirSync(tmpDir), []);
});

test("saveHtml reports a failed write as an error toast", async () => {
  const target = `${tmpDir}/missing-dir/out.html`;
  windowApi.showSaveDialog = async () => Uri.file(target);
  const before = __errorMessages().length;
  BriefPanel.show(brief());
  panel().webview.__receiveFromClient({ type: "saveHtml" });
  await settle(() => __errorMessages().length === before + 1);
  assert.match(__errorMessages()[before], /^Failed to save brief: ENOENT/);
});

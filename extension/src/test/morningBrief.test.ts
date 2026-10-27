// Tests for the Open Morning Brief command: which brief it shows and the empty message.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __registeredCommands, __lastWebviewPanel, __resetWebviewPanels, __infoMessages, __resetInfo } from "./_stub/vscode";
import { registerMorningBriefCommand } from "../commands/morningBrief";
import { registrarContext, captureRegistrations, declaredCommandIds } from "./registrarCheck";
import { recordLastBrief, clearAllBriefs } from "../exec/lastBrief";
import type { RoutineBrief } from "../exec/routineRunner";
import { settle } from "./settle";
import { l10n } from "../i18n/l10n";

const ID = "saropaWorkspace.openMorningBrief";

function brief(name: string, generatedAt: string): RoutineBrief {
  return { routineName: name, generatedAt, verdict: "clear", attentionCount: 0, members: [], summaryPath: "/r/s.md" };
}

const open = (arg?: string): unknown => __registeredCommands().get(ID)!(arg);
const shown = (): RoutineBrief | undefined => {
  const sent = __lastWebviewPanel()?.webview.postedMessages as Array<{ brief: RoutineBrief }> | undefined;
  return sent?.[sent.length - 1]?.brief;
};

beforeEach(() => registerMorningBriefCommand(registrarContext()));

afterEach(() => {
  clearAllBriefs();
  __resetWebviewPanels();
  __resetInfo();
});

test("it registers exactly the declared command id, once", () => {
  const ids = captureRegistrations(() => registerMorningBriefCommand(registrarContext()));
  assert.deepEqual(ids, [ID]);
  assert.ok(declaredCommandIds().includes(ID));
});

test("with no brief recorded it says there is none and opens no panel", () => {
  open();
  open("missing-routine");
  assert.deepEqual(__infoMessages(), [l10n("brief.none"), l10n("brief.none")]);
  assert.equal(__lastWebviewPanel(), undefined);
});

test("with a routine id it shows that routine's brief, not the newest one", async () => {
  recordLastBrief("a", brief("Old routine", "2026-01-01T00:00:00.000Z"));
  recordLastBrief("b", brief("New routine", "2026-02-01T00:00:00.000Z"));
  open("a");
  assert.ok(__lastWebviewPanel());
  // The first show builds the panel; the brief is sent on the page's ready message.
  __lastWebviewPanel()!.webview.__receiveFromClient({ type: "ready" });
  await settle(() => shown() !== undefined);
  assert.equal(shown()?.routineName, "Old routine");
});

test("with no id it shows the newest brief of any routine", async () => {
  recordLastBrief("a", brief("Old routine", "2026-01-01T00:00:00.000Z"));
  recordLastBrief("b", brief("New routine", "2026-02-01T00:00:00.000Z"));
  open();
  __lastWebviewPanel()!.webview.__receiveFromClient({ type: "ready" });
  await settle(() => shown() !== undefined);
  assert.equal(shown()?.routineName, "New routine");
});

// Tests for the Release Board string table: every entry resolves to real text, the
// placeholders the page fills later are kept, and the hand-to-chat label follows its setting.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __setConfig, __resetConfig } from "./_stub/vscode";
import { strings } from "../views/boardStrings";
import { l10n } from "../i18n/l10n";

const SECTION = "saropaWorkspace.releaseBoard.handToChat";

beforeEach(() => __resetConfig());

test("every entry is non-empty text and none is an unresolved catalog key", () => {
  const table = strings() as unknown as Record<string, string | Record<string, string>>;
  const check = (name: string, value: unknown): void => {
    assert.equal(typeof value, "string", name);
    const text = value as string;
    assert.ok(text.length > 0, `${name} is empty`);
    assert.ok(!/^releaseBoard\.[\w.]+$/.test(text), `${name} shows a raw key: ${text}`);
  };
  for (const [name, value] of Object.entries(table)) {
    if (typeof value === "object") {
      // A nested table (the Future tab labels): every entry is checked the same way.
      Object.entries(value).forEach(([key, text]) => check(`${name}.${key}`, text));
    } else {
      check(name, value);
    }
  }
});

test("count, days, name and names placeholders are left in the text for the page to fill", () => {
  const t = strings();
  assert.ok(t.more.includes("{count}"));
  assert.ok(t.blocked.includes("{count}"));
  assert.ok(t.reasonGrey.includes("{count}"));
  assert.ok(t.chatsTitle.includes("{count}"));
  assert.ok(t.tidyNote.includes("{days}"));
  assert.ok(t.tidyDetail.includes("{count}") && t.tidyDetail.includes("{days}"));
  assert.ok(t.trainTitle.includes("{name}"));
  assert.ok(t.trainHeldBy.includes("{names}"));
  assert.ok(t.liveProblems.includes("{errors}") && t.liveProblems.includes("{warnings}"));
  assert.ok(t.liveLogs.includes("{errors}") && t.liveLogs.includes("{crashes}"));
});

test("the table carries the same text as the catalog entries it is built from", () => {
  const t = strings();
  assert.equal(t.title, l10n("releaseBoard.panel.title"));
  assert.equal(t.accept, l10n("releaseBoard.accept"));
  assert.equal(t.sittingsButton, l10n("releaseBoard.sittings.button"));
  assert.equal(t.tidyHeading, l10n("releaseBoard.tidy.heading"));
  assert.equal(t.liveHead, l10n("releaseBoard.live.head"));
});

test("the hand-to-chat label is shown by default and empty when the setting turns it off", () => {
  assert.equal(strings().handToChat, l10n("releaseBoard.handToChat.button"));
  __setConfig(SECTION, "enabled", false);
  assert.equal(strings().handToChat, "");
  assert.equal(strings().handToChatTip, l10n("releaseBoard.handToChat.tip"));
});

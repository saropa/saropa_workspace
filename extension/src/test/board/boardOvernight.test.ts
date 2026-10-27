// Overnight run host side: when the offer shows, and the commands that answer it.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BoardConfig } from "../../board/types";
import { ShortcutStore } from "../../model/shortcutStore";
import { onDidChangeOvernightOffer, overnightOfferVisible, registerBoardOvernight } from "../../commands/boardOvernight";
import { contextIn, stub, tmpDir } from "./hostHelpers";

afterEach(() => stub.__resetConfig());

test("the offer shows while the run is off and not dismissed", () => {
  assert.equal(overnightOfferVisible(contextIn(tmpDir())), true);
});

test("the offer is gone once the run is on, once dismissed, or with the board off", async () => {
  stub.__setConfig("saropaWorkspace.releaseBoard.overnight", "enabled", true);
  assert.equal(overnightOfferVisible(contextIn(tmpDir())), false);
  stub.__resetConfig();
  const ctx = contextIn(tmpDir());
  await ctx.globalState.update("saropaWorkspace.releaseBoard.overnight.offerDismissed", true);
  assert.equal(overnightOfferVisible(ctx), false);
  stub.__setConfig("saropaWorkspace.releaseBoard", "enabled", false);
  assert.equal(overnightOfferVisible(contextIn(tmpDir())), false);
});

test("dismissing the offer is remembered and repaints the sidebar", async () => {
  const ctx = contextIn(tmpDir());
  const store = {} as ShortcutStore;
  registerBoardOvernight(ctx, store, async () => ({ version: 1, ignore: [], ruleSets: {}, projects: [] }) as BoardConfig);
  try {
    let repaints = 0;
    const sub = onDidChangeOvernightOffer(() => (repaints += 1));
    const dismiss = stub.__registeredCommands().get("saropaWorkspace.releaseBoard.overnight.dismissOffer");
    assert.ok(dismiss);
    await dismiss();
    assert.equal(repaints, 1);
    assert.equal(overnightOfferVisible(ctx), false);
    sub.dispose();
  } finally {
    // Stops the timers the registration started.
    ctx.subscriptions.forEach((d) => d.dispose());
  }
});

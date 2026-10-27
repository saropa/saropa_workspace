// Sittings host side: settings are clamped, the remembered choice round-trips.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readSittingsChoice, readSittingsSettings, saveSittingsChoice } from "../../commands/boardSittings";
import { contextIn, stub, tmpDir } from "./hostHelpers";

const SECTION = "saropaWorkspace.releaseBoard.sittings";

afterEach(() => stub.__resetConfig());

test("defaults", () => {
  assert.deepEqual(readSittingsSettings(), { enabled: true, defaultHave: [], defaultTimeBox: "any", maxSteps: 25, onlyOwnerDocuments: true });
});

test("max steps is kept between 5 and 100", () => {
  stub.__setConfig(SECTION, "maxSteps", 1);
  assert.equal(readSittingsSettings().maxSteps, 5);
  stub.__setConfig(SECTION, "maxSteps", 500);
  assert.equal(readSittingsSettings().maxSteps, 100);
  stub.__setConfig(SECTION, "maxSteps", "many");
  assert.equal(readSittingsSettings().maxSteps, 25);
});

test("default have keeps only strings and ignores a non-list", () => {
  stub.__setConfig(SECTION, "defaultHave", ["a", 3, "b"]);
  assert.deepEqual(readSittingsSettings().defaultHave, ["a", "b"]);
  stub.__setConfig(SECTION, "defaultHave", "a");
  assert.deepEqual(readSittingsSettings().defaultHave, []);
});

test("no choice is stored at first, and a saved one comes back", async () => {
  const ctx = contextIn(tmpDir());
  assert.equal(readSittingsChoice(ctx), undefined);
  await saveSittingsChoice(ctx, { have: ["laptop"], timeBox: "any" });
  assert.deepEqual(readSittingsChoice(ctx), { have: ["laptop"], timeBox: "any" });
});

test("a damaged stored choice is dropped", async () => {
  const ctx = contextIn(tmpDir());
  await ctx.globalState.update("releaseBoard.sittings.choice", { have: "nope" });
  assert.equal(readSittingsChoice(ctx), undefined);
});

// Unit tests for the assembled launcher client script and its fragments
// (core, split, cards, render, folded, menu): the pieces are concatenated into one
// script, so the whole must parse and each fragment must be present.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCHER_SCRIPT } from "../views/launcherScript";
import { LAUNCHER_SCRIPT_CORE } from "../views/launcher/launcherScriptCore";
import { LAUNCHER_SCRIPT_SPLIT } from "../views/launcher/launcherScriptSplit";
import { LAUNCHER_SCRIPT_CARDS } from "../views/launcher/launcherScriptCards";
import { LAUNCHER_SCRIPT_RENDER } from "../views/launcher/launcherScriptRender";
import { LAUNCHER_SCRIPT_FOLDED } from "../views/launcher/launcherScriptFolded";
import { LAUNCHER_SCRIPT_MENU } from "../views/launcher/launcherScriptMenu";
import { assertScriptParses, assertNoRemoteLoads, assertSingleApiHandle } from "./_stub/assetChecks";

const FRAGMENTS = {
  core: LAUNCHER_SCRIPT_CORE,
  split: LAUNCHER_SCRIPT_SPLIT,
  cards: LAUNCHER_SCRIPT_CARDS,
  render: LAUNCHER_SCRIPT_RENDER,
  folded: LAUNCHER_SCRIPT_FOLDED,
  menu: LAUNCHER_SCRIPT_MENU,
};

test("the assembled script parses and loads nothing remote", () => {
  assertScriptParses("LAUNCHER_SCRIPT", LAUNCHER_SCRIPT);
  assertNoRemoteLoads("LAUNCHER_SCRIPT", LAUNCHER_SCRIPT);
});

test("the VS Code API is acquired once, in the core fragment", () => {
  assertSingleApiHandle("LAUNCHER_SCRIPT", LAUNCHER_SCRIPT);
  assert.ok(LAUNCHER_SCRIPT_CORE.includes("acquireVsCodeApi()"));
});

test("every fragment is non-empty and appears in the assembled script, in order", () => {
  let from = 0;
  for (const [name, fragment] of Object.entries(FRAGMENTS)) {
    assert.ok(fragment.trim().length > 0, `${name} is empty`);
    const at = LAUNCHER_SCRIPT.indexOf(fragment, from);
    assert.ok(at >= 0, `${name} missing or out of order`);
    from = at + fragment.length;
  }
});

test("the script listens for host messages", () => {
  assert.ok(/addEventListener\((['"])message\1/.test(LAUNCHER_SCRIPT));
});

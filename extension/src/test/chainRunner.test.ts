// Chain engine (recipe chaining + special events). The ChainRunner class wires two
// event buses and the idle monitor and routes through the Run command, which needs
// the extension host; but its one exported pure helper — toBackground — is the
// force-to-background shortcut clone the idle path and the cross-file watch links reuse,
// and it is testable in isolation. These cases shortcut its two shapes (a file shortcut vs a
// recipe-action shortcut) and prove it never mutates the stored shortcut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toBackground } from "../exec/chainRunner";
import type { Shortcut } from "../model/shortcut";

function fileShortcut(over: Partial<Shortcut> = {}): Shortcut {
  return {
    id: "p1",
    path: "build.sh",
    scope: "project",
    order: 0,
    ...over,
  } as Shortcut;
}

test("a file pin is forced to the background run location", () => {
  const shortcut = fileShortcut({
    exec: { command: "bash", useIntegratedTerminal: true },
  });

  const bg = toBackground(shortcut);

  assert.equal(bg.exec?.runLocation, "background", "the run is routed off the terminal");
  assert.equal(
    bg.exec?.useIntegratedTerminal,
    undefined,
    "the deprecated terminal flag is cleared so the two sources cannot disagree"
  );
  assert.equal(bg.exec?.command, "bash", "the rest of the exec config is preserved");
});

test("a file pin with no exec still gets a background exec config", () => {
  const shortcut = fileShortcut();

  const bg = toBackground(shortcut);

  assert.equal(bg.exec?.runLocation, "background");
  assert.equal(bg.exec?.useIntegratedTerminal, undefined);
});

test("a recipe-action pin gets its action's integrated-terminal flag cleared", () => {
  // A shell recipe carries the terminal flag on its action, not exec; toBackground
  // clears that path instead so an idle/auto run never steals the terminal.
  const shortcut = fileShortcut({
    action: { kind: "shell", shellCommand: "npm test", useIntegratedTerminal: true },
  });

  const bg = toBackground(shortcut);

  assert.equal(
    bg.action?.useIntegratedTerminal,
    false,
    "the action's terminal flag is forced off"
  );
  assert.equal(bg.action?.shellCommand, "npm test", "the action's command is preserved");
  assert.equal(
    bg.exec,
    undefined,
    "a recipe pin's exec is left untouched (the action branch is taken)"
  );
});

test("toBackground returns a clone and never mutates the stored pin", () => {
  const shortcut = fileShortcut({
    exec: { command: "node", useIntegratedTerminal: true },
  });

  const bg = toBackground(shortcut);

  assert.notEqual(bg, shortcut, "a fresh object is returned");
  assert.equal(
    shortcut.exec?.useIntegratedTerminal,
    true,
    "the original pin's exec is unchanged — the override applies to this run only"
  );
  assert.equal(shortcut.exec?.runLocation, undefined, "the stored pin keeps its own location");
});

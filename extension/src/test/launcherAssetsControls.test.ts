// Tests for the second half of the launcher stylesheet (cards, groups, drawers, menus).
// It is a plain string, so the tests check what the rest of the launcher relies on: the file
// is well formed, colors follow the editor theme, the classes the client script toggles have
// rules, and the variables it reads are defined.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCHER_STYLE_CONTROLS } from "../views/launcherAssetsControls";
import { LAUNCHER_STYLE } from "../views/launcherAssets";
import { LAUNCHER_SCRIPT } from "../views/launcherScript";

// The first half ends inside a comment, so this sheet starts with the tail of that comment;
// the tail is dropped before the remaining comments are removed.
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const ownText = LAUNCHER_STYLE_CONTROLS.replace(/^[\s\S]*?\*\//, "");
const noComments = strip(ownText);

/** The declaration block of the first rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string | undefined {
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) {
      return m[2];
    }
  }
  return undefined;
}

test("the sheet is appended unchanged to the end of the launcher stylesheet", () => {
  assert.ok(LAUNCHER_STYLE.endsWith(LAUNCHER_STYLE_CONTROLS));
  assert.ok(LAUNCHER_STYLE.length > LAUNCHER_STYLE_CONTROLS.length);
});

test("the first half ends inside a comment that this sheet closes", () => {
  assert.ok(LAUNCHER_STYLE_CONTROLS.indexOf("*/") < LAUNCHER_STYLE_CONTROLS.indexOf("/*"));
});

test("in the joined stylesheet braces and comments balance", () => {
  const joined = strip(LAUNCHER_STYLE);
  assert.equal(joined.includes("/*") || joined.includes("*/"), false);
  assert.equal((joined.match(/\{/g) ?? []).length, (joined.match(/\}/g) ?? []).length);
});

test("no color is hardcoded: no hex, rgb, hsl or named color value", () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(noComments), false);
  assert.equal(/\b(rgb|rgba|hsl|hsla)\(/.test(noComments), false);
  const named = /(?:^|[;{\s])(?:color|background|border(?:-[a-z]+)?)\s*:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow)\b/m;
  assert.equal(named.test(noComments), false);
});

test("the launcher button variables used here are defined in the root rule of the first half", () => {
  const used = new Set(noComments.match(/var\((--launcher-[a-z-]+)\)/g)?.map((v) => v.slice(4, -1)));
  assert.deepEqual([...used].sort(), ["--launcher-btn-font", "--launcher-btn-icon", "--launcher-btn-pad"]);
  for (const name of used) {
    assert.match(LAUNCHER_STYLE, new RegExp(`${name}:\\s*[^;]+;`), `${name} is defined`);
  }
});

test("the card tint variable is set by the client script that this sheet reads it from", () => {
  assert.match(noComments, /var\(--card-tint, var\(--vscode-foreground\)\)/);
  assert.ok(LAUNCHER_SCRIPT.includes("'--card-tint'"));
});

test("every state class the client script toggles has a rule here", () => {
  const states: Array<[string, string]> = [
    ["collapsed", ".group.collapsed .group-body"],
    ["expanded", ".card.expanded .drawer"],
    ["searching", ".root.searching .group .group-body"],
    ["can-drop", ".group.can-drop .group-head"],
    ["drop-over", ".card.drop-over"],
    ["hidden", ".card.hidden"],
    ["resizing", "body.resizing"],
  ];
  for (const [cls, selector] of states) {
    assert.ok(LAUNCHER_SCRIPT.includes(`'${cls}'`), `the script uses ${cls}`);
    assert.notEqual(ruleBody(selector), undefined, `${selector} has a rule`);
  }
});

test("a collapsed group hides its body, a search shows it again, a hidden card is removed", () => {
  assert.equal(ruleBody(".group.collapsed .group-body")?.trim(), "display: none;");
  assert.equal(ruleBody(".root.searching .group .group-body")?.trim(), "display: grid;");
  assert.equal(ruleBody(".card.hidden")?.trim(), "display: none;");
  assert.equal(ruleBody(".pane.hidden")?.trim(), "display: none;");
});

test("the card grid reflows by width and cards keep their own height", () => {
  const grid = ruleBody(".grid") ?? "";
  assert.match(grid, /grid-template-columns:\s*repeat\(auto-fill, minmax\(247px, 1fr\)\);/);
  assert.match(grid, /align-items:\s*start;/);
});

test("the drawer is hidden until its card expands", () => {
  assert.match(ruleBody(".drawer") ?? "", /display:\s*none;/);
  assert.match(ruleBody(".card.expanded .drawer") ?? "", /display:\s*block;/);
});

test("the run button shows its text label only on an expanded card", () => {
  assert.match(ruleBody(".run-label") ?? "", /display:\s*none;/);
  assert.match(ruleBody(".card.expanded .run-label") ?? "", /display:\s*inline;/);
});

test("the keyboard-focus ring is drawn on the pane head, group head and menu items", () => {
  assert.match(ruleBody(".pane-head:focus-visible") ?? "", /outline:\s*1px solid var\(--vscode-focusBorder\)/);
  assert.match(ruleBody(".group-head:focus-visible") ?? "", /outline:\s*1px solid var\(--vscode-focusBorder\)/);
  assert.notEqual(ruleBody(".menu-item:focus-visible"), undefined);
});

test("the menu floats above the cards and a submenu above the menu", () => {
  const z = (selector: string): number => Number(/z-index:\s*(\d+)/.exec(ruleBody(selector) ?? "")?.[1]);
  assert.equal(z(".menu"), 20);
  assert.equal(z(".menu-sub"), 21);
  assert.match(ruleBody(".menu") ?? "", /position:\s*fixed;/);
});

test("the dangerous menu row uses the theme error color", () => {
  assert.match(ruleBody(".menu-item.danger") ?? "", /color:\s*var\(--vscode-errorForeground\);/);
});

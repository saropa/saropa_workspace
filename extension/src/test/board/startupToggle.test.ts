import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { startupToggle } from "../../board/boardHtmlProjects";
import { buildBoard } from "../../board/boardModel";
import { strings } from "../../views/boardStrings";
import { DEFAULT_STARTUP_MODE, checkboxValue, isStartupOn, modeForCheckbox, modeToRemember, rememberedMode } from "../../board/startupToggle";

const t = { projectLabels: { startup: "Open this board at start-up", startupTip: "When off, the board only opens from the sidebar or the command." } } as unknown as BoardStrings;

test("the box is checked for every mode but never", () => {
  assert.equal(isStartupOn("never"), false);
  assert.equal(isStartupOn("whenProjectsFound"), true);
  assert.equal(isStartupOn("always"), true);
});

test("unchecking writes never; checking restores the remembered mode", () => {
  assert.equal(modeForCheckbox(false, "always"), "never");
  assert.equal(modeForCheckbox(true, "always"), "always");
  assert.equal(modeForCheckbox(true, undefined), DEFAULT_STARTUP_MODE);
  assert.equal(modeForCheckbox(true, "never"), "whenProjectsFound");
  assert.equal(modeForCheckbox(true, 42), "whenProjectsFound");
});

test("only an opening mode is remembered", () => {
  assert.equal(rememberedMode("always"), "always");
  assert.equal(rememberedMode("junk"), "whenProjectsFound");
  assert.equal(modeToRemember("never"), undefined);
  assert.equal(modeToRemember("always"), "always");
  assert.equal(modeToRemember(undefined), "whenProjectsFound");
  assert.equal(modeToRemember("junk"), "whenProjectsFound");
});

test("the page value must be a boolean", () => {
  assert.equal(checkboxValue(true), true);
  assert.equal(checkboxValue(false), false);
  for (const v of ["true", 1, 0, null, undefined, {}]) {
    assert.equal(checkboxValue(v), undefined);
  }
});

test("the checkbox shows the state, is labeled, and is left out when unknown", () => {
  assert.equal(startupToggle(undefined, t), "");
  const on = startupToggle(true, t);
  const off = startupToggle(false, t);
  assert.ok(on.includes(" checked") && !off.includes(" checked"));
  for (const html of [on, off]) {
    assert.ok(html.includes('aria-label="Open this board at start-up"'));
    assert.ok(html.includes("only opens from the sidebar or the command"));
    assert.ok(html.includes("<span>Open this board at start-up</span>"));
  }
});

test("the checkbox is the last control of the top bar and sends only a boolean", () => {
  const m = buildBoard({ version: 1, ignore: [], ruleSets: {}, projects: [{ id: "a", name: "A", path: "a", roots: ["docs"], ruleSets: [] }] }, [], undefined, true);
  const real = strings();
  const html = renderBoard(m, real, "n", 3, { startup: true });
  const top = html.slice(html.indexOf('<div class="top">'), html.indexOf("</div>", html.indexOf('<div class="top">')));
  assert.ok(top.indexOf('id="refresh"') < top.indexOf("data-startup"));
  assert.ok(top.indexOf("data-menu=\"opts\"") < top.indexOf("data-startup"));
  assert.ok(top.endsWith("</label>"));
  assert.ok(html.includes("type:'startup',value:b.checked===true,rev:REV"));
  assert.ok(!renderBoard(m, real, "n", 3).includes("<label class=\"stup\""));
});

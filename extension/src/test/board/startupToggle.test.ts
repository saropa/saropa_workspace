import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardStrings, renderBoard } from "../../board/boardHtml";
import { startupToggle } from "../../board/boardHtmlProjects";
import { buildBoard } from "../../board/boardModel";
import { strings } from "../../views/boardStrings";
import { DEFAULT_STARTUP_MODE, checkboxValue, isStartupOn, modeForCheckbox, modeToRemember, planStartupWrite, rememberedMode } from "../../board/startupToggle";

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

test("a user's always is never lowered when the box is checked again", () => {
  // Nothing remembered, effective never, user value never: the default.
  assert.deepEqual(planStartupWrite(true, "never", undefined, "never"), { remember: undefined, mode: "whenProjectsFound" });
  // Nothing remembered, effective never (a workspace value), user value always: keep always.
  assert.deepEqual(planStartupWrite(true, "never", undefined, "always"), { remember: undefined, mode: "always" });
  // A remembered mode wins over the user value.
  assert.equal(planStartupWrite(true, "never", "whenProjectsFound", "always").mode, "whenProjectsFound");
  // Unset user value.
  assert.equal(planStartupWrite(true, "never", "junk", undefined).mode, "whenProjectsFound");
});

test("the mode in force is saved before never is written", () => {
  assert.deepEqual(planStartupWrite(false, "always", undefined, "always"), { remember: "always", mode: "never" });
  assert.deepEqual(planStartupWrite(false, undefined, undefined, undefined), { remember: "whenProjectsFound", mode: "never" });
  // Already never: nothing new to remember, never is written again.
  assert.deepEqual(planStartupWrite(false, "never", "always", "never"), { remember: undefined, mode: "never" });
  // Checking with the setting on keeps it.
  assert.equal(planStartupWrite(true, "always", undefined, "never").mode, "always");
});

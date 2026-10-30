// The page script and style sheet: what they carry and what they must not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE, script } from "../../board/boardHtmlAssets";

test("the script carries the revision as a number and the profile as a quoted value", () => {
  const js = script(42, "Refreshing", "deliberate");
  assert.ok(js.includes("const REV=42;"));
  assert.ok(js.includes('const PROFILE="deliberate"'));
  assert.ok(js.includes('const LABEL="Refreshing"'));
});

test("a value cannot close the script element", () => {
  const js = script(1, "</script><b>", "</script>");
  assert.ok(!js.includes("</script>"));
  assert.ok(js.includes("\\u003c/script>"));
});

test("every message the page posts carries the revision and only indexes or keys", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("const REV=1;"));
  for (const type of ["refresh", "open", "path", "hand", "tidy", "liveBug", "external", "step", "sitting", "profile", "rowMenu", "optsMenu", "accept", "suggest", "assign", "preview", "futureOpen"]) {
    assert.ok(new RegExp(`type:'${type}'[^;]*rev:REV`).test(js), `posts ${type} with the revision`);
  }
  assert.equal(js.includes("type:'rules'"), false, "the page has no way to open the rules file but the menus");
  assert.ok(!/path:[a-z]*\.(dataset|textContent)/i.test(js), "no file path is read from the page");
  assert.ok(!js.includes("href"), "the page opens nothing by URL");
});

test("the script uses the host's API only through the one handle", () => {
  const js = script(1, "x", "y");
  assert.equal(js.match(/acquireVsCodeApi\(\)/g)?.length, 1);
});

test("the style sheet follows the editor theme and has a reduced-motion rule", () => {
  assert.ok(STYLE.includes("--vscode-editor-background"));
  assert.ok(STYLE.includes("prefers-reduced-motion"));
  assert.ok(!STYLE.includes("</style"), "cannot end its element early");
});

test("a filter pick updates the page's own copy of the choice, so two quick picks do not lose the first", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("SIT.have=msg.have;SIT.box=msg.box;"));
});

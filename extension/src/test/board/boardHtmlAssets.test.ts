// The page script and style sheet: what they carry and what they must not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE, script } from "../../board/boardHtmlAssets";
import { docLink, escapeHtml } from "../../board/boardHtmlUtil";

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
  for (const type of ["refresh", "open", "path", "tidy", "liveBug", "external", "step", "sitting", "profile", "rowMenu", "scopeMenu", "optsMenu", "accept", "suggest", "assign", "preview", "futureOpen"]) {
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

test("the checked mark of a menu item is a CSS escape, not the text u2713", () => {
  assert.ok(STYLE.includes('.mi[aria-checked=true]::before{content:"\\2713"}'));
  assert.equal(STYLE.includes("\\u2713"), false);
});

test("the menu buttons stop only the keys they handle, so + and - reach the document", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("if(!/^(Enter| |ArrowDown|ArrowUp|Escape)$/.test(e.key)){return;}e.stopPropagation();"));
  assert.equal(js.includes("addEventListener('keydown',e=>{e.stopPropagation();"), false);
});

test("a status choice has an effect line, the chosen status is found by kind, and a refused row is released", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("a.indexOf('status:')===0") && js.includes("E.eff.sOn") && js.includes("E.eff.lGo") && js.includes("E.eff.lNoGo"));
  assert.ok(js.includes("r.dataset.kd||''") && js.includes("n===pick"));
  assert.ok(js.includes("d.type==='clearPending'") && js.includes("d.type==='undoOn'"));
  assert.ok(js.includes("clearTimeout(PT[id])") && js.includes("document.body.classList.contains('busy')"), "the fallback timer is replaced on a new pend and waits while a scan runs");
});

import { HANDOFF_SCRIPT } from "../../board/boardHtmlHandoff";
import { PROJECTS_SCRIPT } from "../../board/boardHtmlProjects";

test("rows on demand: the Show more buttons use their own attribute, which the More strip ignores", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("wired('[data-rowsmore]'"));
  assert.ok(!js.includes("wired('[data-more]'"));
  assert.ok(!/hasAttribute\('data-more'\)/.test(js));
  // The strip loops over [data-more] only; no Show more button may match it.
  assert.ok(PROJECTS_SCRIPT.includes("querySelectorAll('[data-more]')"));
  assert.ok(!PROJECTS_SCRIPT.includes("data-rowsmore"));
});

test("rows on demand: the row controls are wired again for rows that arrive later", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("wireIn(c)"), "a rows reply wires the new rows");
  for (const sel of ["[data-menu]", "a.doc", ".row[data-id]"]) {
    assert.ok(js.includes(`wired('${sel}'`), `${sel} is registered`);
  }
  assert.ok(HANDOFF_SCRIPT.includes("wired('[data-choose]'"), "the checkbox is registered, not wired once at load");
  assert.ok(HANDOFF_SCRIPT.includes("c.checked=CH.has("), "a checkbox that arrives later is ticked from the chosen ids");
  assert.ok(HANDOFF_SCRIPT.includes("c.addEventListener('click',stop)"), "a click on the checkbox does not open the row");
  assert.ok(!/document\.querySelectorAll\('\[data-choose\]'\)\.forEach\(c=>\{const stop/.test(HANDOFF_SCRIPT));
  // Drag start is delegated from the document, so it covers later rows.
  assert.ok(!js.includes("addEventListener('dragstart'"));
});

test("rows on demand: scroll is restored after the replies and not saved while they are pending", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("const keep=()=>{if(PENDQ.size>0){return;}"));
  assert.ok(js.includes("if(PENDQ.size===0&&RESTORE){window.scrollTo(0,RESTORE);RESTORE=0;}"));
});

test("rows on demand: a request with no reply times out and can be asked again", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("setTimeout(()=>settle(id,by,from,true),10000)"));
  assert.ok(js.includes("delete c.dataset.asked"));
  assert.ok(js.includes("b.disabled=false;b.removeAttribute('aria-busy')"));
});

test("rows on demand: openGroupRows is available to code that needs the rows of a closed group", () => {
  const js = script(1, "x", "y");
  assert.ok(js.includes("const openGroupRows=id=>"));
  assert.ok(js.includes("return Promise.resolve()"));
});

test("a long work item name is cut with an ellipsis on one line, also on narrow boards", () => {
  assert.ok(/\.row \.f\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(STYLE));
  assert.ok(/\.cn \.f\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(STYLE));
  assert.ok(/\.fl \.f\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(STYLE));
  assert.ok(/a\.doc\{white-space:nowrap\}/.test(STYLE));
});

test("a document link's title carries the full escaped name, then the path on a second line", () => {
  const long = "Scripts — a 4th category: a bundled, taggable, configurable script library ".repeat(3) + "<b>";
  const html = docLink(long, "docs/a.md", 'data-id="1"');
  assert.ok(html.includes(`title="${escapeHtml(long)}\ndocs/a.md"`));
  assert.ok(!html.includes("<b>"));
});

test("a document link's title is never shortened, however long the name or path", () => {
  const name = "n".repeat(250);
  const path = "docs/" + "p".repeat(250) + ".md";
  const html = docLink(name, path, 'data-id="1"');
  assert.ok(html.includes(`title="${name}\n${path}"`));
  assert.ok(!html.includes("…"));
});

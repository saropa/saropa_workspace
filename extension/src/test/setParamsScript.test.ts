// Behavior tests for the Set Parameters webview script. The panel's page is a static shell
// (see SetParamsPanel.renderShell); this test mirrors its three elements and runs the real
// script against them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SET_PARAMS_SCRIPT } from "../views/setParamsScript";
import { runPage, type FakeElement, type Page } from "./_stub/fakeDom";

const EVIL = '<img src=x onerror="alert(1)">&"\'';

const PAGE = `<!DOCTYPE html><html><body>
<div class="card" id="fields"></div>
<div class="footer"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div>
<script>${SET_PARAMS_SCRIPT}</script>
</body></html>`;

interface Field { raw: string; label: string; kind: string; value: string; options?: string[]; answered?: boolean; browseLabel?: string; resetLabel?: string }

const open = (): Page => runPage(PAGE);
function init(page: Page, fields: Field[]): void {
  page.receive({ type: "init", fields });
}
const input = (page: Page, raw: string): FakeElement => page.one(`[data-raw="${raw}"]`);
const save = (page: Page): FakeElement => page.byId("save");

const TEXT: Field = { raw: "${name}", label: "Name", kind: "text", value: "Ada" };
const PICK: Field = { raw: "${env}", label: "Environment", kind: "pick", value: "staging", options: ["dev", "staging", "prod"] };
const FOLDER: Field = { raw: "${dir}", label: "Folder", kind: "pickFolder", value: "", browseLabel: "Browse", resetLabel: "Reset" };

test("loading tells the host the panel is ready", () => {
  assert.deepEqual(open().takePosted(), [{ type: "ready" }]);
});

test("an init message builds one row per field with its label and starting value", () => {
  const page = open();
  init(page, [TEXT, PICK, { ...FOLDER, value: "/work" }]);
  assert.deepEqual(page.all(".field .lab").map((l) => l.textContent), ["Name", "Environment", "Folder"]);
  assert.equal(input(page, "${name}").tag, "input");
  assert.equal(input(page, "${name}").value, "Ada");
  assert.equal(input(page, "${dir}").value, "/work");
});

test("a pick field is a list of its options with the current value selected", () => {
  const page = open();
  init(page, [PICK]);
  const select = input(page, "${env}");
  assert.equal(select.tag, "select");
  assert.deepEqual(select.children.map((o) => o.textContent), ["dev", "staging", "prod"]);
  assert.equal(select.value, "staging");
});

test("a folder field is read-only with a Browse button that asks the host for a folder", () => {
  const page = open();
  init(page, [{ ...FOLDER, value: "/work" }]);
  assert.equal(input(page, "${dir}").readOnly, true);
  assert.equal(input(page, "${dir}").dataset.kind, "pickFolder");
  page.takePosted();
  const browse = page.one(".fieldrow .btn");
  assert.equal(browse.textContent, "Browse");
  page.click(browse);
  assert.deepEqual(page.takePosted(), [{ type: "browse", raw: "${dir}" }]);
});

test("a reply to browse fills the matching field", () => {
  const page = open();
  init(page, [TEXT, FOLDER]);
  page.receive({ type: "browsed", raw: "${dir}", value: "/picked" });
  assert.equal(input(page, "${dir}").value, "/picked");
  assert.equal(input(page, "${name}").value, "Ada");
  page.receive({ type: "browsed", raw: "${unknown}", value: "/lost" });
  assert.equal(input(page, "${dir}").value, "/picked");
});

test("Save stays disabled while a folder field is empty and enables once it is filled", () => {
  const page = open();
  init(page, [TEXT, FOLDER]);
  assert.equal(save(page).disabled, true);
  page.receive({ type: "browsed", raw: "${dir}", value: "   " });
  assert.equal(save(page).disabled, true);
  page.receive({ type: "browsed", raw: "${dir}", value: "/ok" });
  assert.equal(save(page).disabled, false);
});

test("Save is enabled when no folder field is required", () => {
  const page = open();
  init(page, [TEXT, PICK]);
  assert.equal(save(page).disabled, false);
});

test("Save posts every field's current value keyed by its raw token", () => {
  const page = open();
  init(page, [TEXT, PICK, { ...FOLDER, value: "/work" }]);
  page.type(input(page, "${name}"), "Grace");
  input(page, "${env}").value = "prod";
  page.takePosted();
  page.click(save(page));
  assert.deepEqual(page.takePosted(), [{ type: "save", values: { "${name}": "Grace", "${env}": "prod", "${dir}": "/work" } }]);
});

test("Cancel posts cancel", () => {
  const page = open();
  page.takePosted();
  page.click(page.byId("cancel"));
  assert.deepEqual(page.takePosted(), [{ type: "cancel" }]);
});

test("an answered field gets a reset button that posts reset for its token", () => {
  const page = open();
  init(page, [{ ...TEXT, answered: true, resetLabel: "Forget answer" }, PICK]);
  const resets = page.all(".iconbtn");
  assert.equal(resets.length, 1);
  assert.deepEqual([resets[0].title, resets[0].getAttribute("aria-label"), resets[0].textContent], ["Forget answer", "Forget answer", "↺"]);
  page.takePosted();
  page.click(resets[0]);
  assert.deepEqual(page.takePosted(), [{ type: "reset", raw: "${name}" }]);
});

test("a second init replaces the rows and forgets the old inputs", () => {
  const page = open();
  init(page, [TEXT, FOLDER]);
  init(page, [PICK]);
  assert.equal(page.all(".field").length, 1);
  assert.equal(save(page).disabled, false);
  page.takePosted();
  page.click(save(page));
  assert.deepEqual(page.takePosted(), [{ type: "save", values: { "${env}": "staging" } }]);
});

test("labels, options and values from the host are written as text and values, never markup", () => {
  const page = open();
  init(page, [{ raw: "${a}", label: EVIL, kind: "text", value: EVIL }, { raw: "${b}", label: "B", kind: "pick", value: EVIL, options: [EVIL, "x"] }]);
  assert.equal(page.all("img").length, 0);
  assert.equal(page.one(".lab").textContent, EVIL);
  assert.equal(input(page, "${a}").value, EVIL);
  assert.equal(input(page, "${b}").children[0].textContent, EVIL);
  assert.equal(input(page, "${b}").value, EVIL);
});

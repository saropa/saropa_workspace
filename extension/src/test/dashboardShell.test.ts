// Unit tests for the Dashboard webview shell (tab selection, CSP, strings).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderShell, type DashboardTab } from "../views/dashboardShell";

const tabs: DashboardTab[] = ["processes", "analytics", "trends"];

for (const tab of tabs) {
  test(`only the ${tab} tab is active and visible when it is the initial tab`, () => {
    const html = renderShell(tab);
    for (const other of tabs) {
      const buttonActive = new RegExp(`class="tab active" data-tab="${other}"`).test(html);
      const panelHidden = new RegExp(`id="tab-${other}" class="tab-panel hidden"`).test(html);
      assert.equal(buttonActive, other === tab, `button ${other}`);
      assert.equal(panelHidden, other !== tab, `panel ${other}`);
    }
    assert.ok(html.includes(`const INITIAL_TAB = ${JSON.stringify(tab)};`));
  });
}

test("CSP nonce matches the inline script and is fresh per render", () => {
  const a = renderShell("processes");
  const b = renderShell("processes");
  const nonce = /script-src 'nonce-([^']+)'/.exec(a)![1];
  assert.ok(a.includes(`<script nonce="${nonce}">`));
  assert.notEqual(nonce, /script-src 'nonce-([^']+)'/.exec(b)![1]);
});

test("the STRINGS table embeds as valid JSON of resolved text", () => {
  const html = renderShell("analytics");
  const json = /const STRINGS = (\{.*\});/.exec(html)![1];
  const strings = JSON.parse(json) as Record<string, string>;
  assert.ok(Object.keys(strings).length > 10);
  for (const [k, v] of Object.entries(strings)) {
    assert.ok(v.length > 0, k);
  }
});

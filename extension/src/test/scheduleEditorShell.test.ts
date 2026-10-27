// Unit tests for the schedule editor's webview document: strict CSP with a matching
// per-render nonce, the fixed card order, and escaping of the shortcut's name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderScheduleEditorHtml } from "../views/scheduleEditorShell";
import type { Shortcut } from "../model/shortcut";
import { scriptOpenTags } from "./assetChecks";

const shortcut = (label: string): Shortcut => ({ id: "s", path: "a.sh", label, scope: "project" }) as Shortcut;

test("the CSP forbids everything except inline styles and the nonce'd script", () => {
  const html = renderScheduleEditorHtml(shortcut("Nightly"));
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("img-src 'none'"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.equal(scriptOpenTags(html).length, 1);
});

test("each render uses a fresh nonce", () => {
  const n = (h: string): string => /nonce-([^']+)'/.exec(h)![1];
  assert.notEqual(n(renderScheduleEditorHtml(shortcut("a"))), n(renderScheduleEditorHtml(shortcut("a"))));
});

test("the shortcut name is escaped everywhere it appears", () => {
  const html = renderScheduleEditorHtml(shortcut(`<img src=x onerror="alert(1)"> & 'q'`));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes('onerror="alert(1)"'));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;q&#39;"));
});

test("the page has seven weekday chips, both footer buttons and the next-run readout", () => {
  const html = renderScheduleEditorHtml(shortcut("x"));
  assert.equal((html.match(/data-day="\d"/g) ?? []).length, 7);
  assert.ok(html.includes('id="save"'));
  assert.ok(html.includes('id="cancel"'));
  assert.ok(html.includes('id="nextRun"'));
});

test("the cards appear in the documented order", () => {
  const html = renderScheduleEditorHtml(shortcut("x"));
  const sections = [...html.matchAll(/class="ttl">([^<]+)</g)].map((m) => m[1]);
  assert.equal(sections.length, 5);
  assert.equal(new Set(sections).size, 5);
  assert.ok(html.indexOf('data-day="0"') < html.indexOf('id="save"'));
});

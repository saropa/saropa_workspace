// Unit tests for the Morning Brief webview shell and its UI string table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBriefShell, briefUiStrings } from "../views/brief/briefShell";

test("shell carries a CSP whose script nonce matches the script tag", () => {
  const html = renderBriefShell();
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
  assert.ok(nonce.length >= 16);
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!csp.includes("unsafe-eval"));
});

test("each render uses a fresh nonce", () => {
  const n = (h: string): string => /nonce-([^']+)'/.exec(h)![1];
  assert.notEqual(n(renderBriefShell()), n(renderBriefShell()));
});

test("shell is a complete document with a content mount point", () => {
  const html = renderBriefShell();
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes('<div id="content"></div>'));
  assert.ok(html.trimEnd().endsWith("</html>"));
});

test("briefUiStrings resolves every key to real text, not the raw key", () => {
  const strings = briefUiStrings();
  assert.ok(Object.keys(strings).length >= 10);
  for (const [k, v] of Object.entries(strings)) {
    assert.ok(v.length > 0, k);
    assert.ok(!v.startsWith("brief."), `${k} unresolved: ${v}`);
  }
});

// Unit tests for the workflow planner's webview document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderShell } from "../views/plannerPanelShell";
import { scriptOpenTags } from "./assetChecks";

test("the CSP is strict and its nonce matches the single inline script", () => {
  const html = renderShell();
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(html.includes(`nonce="${nonce}"`));
  assert.ok(scriptOpenTags(html).length >= 1);
  for (const tag of scriptOpenTags(html)) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `script tag without the nonce: ${tag}`);
  }
});

test("each render uses a fresh nonce", () => {
  const n = (h: string): string => /nonce-([^']+)'/.exec(h)![1];
  assert.notEqual(n(renderShell()), n(renderShell()));
});

test("the document is complete and loads nothing remote", () => {
  const html = renderShell();
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.trimEnd().endsWith("</html>"));
  assert.ok(!/(src|href)="https?:/i.test(html));
});

// Unit tests for the Mobile Remote Control webview document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRemoteControlHtml } from "../views/remoteControl/remoteControlShell";

test("the CSP is strict and every script tag carries its nonce", () => {
  const html = renderRemoteControlHtml();
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!csp.includes("unsafe-eval"));
  const tags = html.split("<script").slice(1).map((part) => "<script" + part.slice(0, part.indexOf(">") + 1));
  assert.ok(tags.length >= 1);
  for (const tag of tags) {
    assert.ok(tag.includes(`nonce="${nonce}"`), tag);
  }
});

test("each render uses a fresh nonce", () => {
  const n = (h: string): string => /nonce-([^']+)'/.exec(h)![1];
  assert.notEqual(n(renderRemoteControlHtml()), n(renderRemoteControlHtml()));
});

test("the document is complete, themed through VS Code variables and loads nothing remote", () => {
  const html = renderRemoteControlHtml();
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.trimEnd().endsWith("</html>"));
  assert.ok(html.includes("var(--vscode-"));
  assert.ok(!/(src|href)="https?:/i.test(html));
});

// Shared assertions for the webview asset strings (inlined CSS and client scripts).
// These strings are plain TypeScript template literals, so the usual failure is a
// bad escape or an unbalanced brace that only shows up as a blank webview at runtime.

import assert from "node:assert/strict";
import * as vm from "node:vm";

// The script must compile as JavaScript. vm.Script only parses; nothing runs.
export function assertScriptParses(name: string, source: string): void {
  assert.ok(source.trim().length > 0, `${name} is empty`);
  assert.doesNotThrow(() => new vm.Script(source, { filename: name }), `${name} has a syntax error`);
}

// Braces in the stylesheet must pair up (comments and strings stripped first).
export function assertCssBalanced(name: string, css: string): void {
  assert.ok(css.trim().length > 0, `${name} is empty`);
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
  let depth = 0;
  for (const ch of stripped) {
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      assert.ok(depth >= 0, `${name}: closing brace without an opener`);
    }
  }
  assert.equal(depth, 0, `${name}: unbalanced braces`);
}

// A webview runs under a strict content security policy; assets must not pull
// anything remote.
export function assertNoRemoteLoads(name: string, source: string): void {
  assert.ok(!/https?:\/\//i.test(source), `${name} references a remote URL`);
  assert.ok(!/@import/i.test(source), `${name} uses @import`);
}

// The script talks to the extension host through the VS Code API exactly once.
export function assertSingleApiHandle(name: string, source: string): void {
  const count = (source.match(/acquireVsCodeApi\(\)/g) ?? []).length;
  assert.equal(count, 1, `${name} must acquire the VS Code API exactly once`);
}

// Every opening <script ...> tag in an HTML document, matched case-insensitively
// with any attributes or whitespace.
export function scriptOpenTags(html: string): string[] {
  return html.match(/<script(?=[\s>/])[^>]*>/gi) ?? [];
}

// Unit tests for the shared webview design-token :root block.

import { test } from "node:test";
import assert from "node:assert/strict";
import { designTokenRoot } from "../views/webviewDesignTokens";

test("defaults to a 160ms duration and a closed :root block", () => {
  const css = designTokenRoot();
  assert.ok(css.startsWith(":root {"));
  assert.ok(css.endsWith("}"));
  assert.ok(css.includes("--dur: 160ms;"));
  assert.ok(css.includes("--surface-1: var(--vscode-editor-background);"));
});

test("a custom duration replaces the default", () => {
  const css = designTokenRoot({ durationMs: 0 });
  assert.ok(css.includes("--dur: 0ms;"));
  assert.ok(!css.includes("160ms"));
});

test("extra declarations are appended inside the block", () => {
  const css = designTokenRoot({ extra: "  --mine: 1px;" });
  assert.ok(css.includes("--mine: 1px;"));
  assert.ok(css.indexOf("--mine") < css.lastIndexOf("}"));
});

// Unit tests for the shared webview-asset assertions: each checker must pass good
// input and fail bad input, or the asset tests that rely on it prove nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertScriptParses, assertCssBalanced, assertNoRemoteLoads, assertSingleApiHandle } from "./assetChecks";

test("assertScriptParses accepts valid JavaScript and rejects a syntax error or empty input", () => {
  assert.doesNotThrow(() => assertScriptParses("ok", "const a = () => 1; a();"));
  assert.throws(() => assertScriptParses("bad", "const = ;"));
  assert.throws(() => assertScriptParses("empty", "  \n"));
});

test("assertScriptParses does not execute the script", () => {
  assert.doesNotThrow(() => assertScriptParses("noexec", "throw new Error('must not run');"));
});

test("assertCssBalanced accepts nested rules and ignores braces in comments and strings", () => {
  assert.doesNotThrow(() => assertCssBalanced("ok", "@media (x) { a { color: red; } } /* } */ b::after { content: '}'; }"));
});

test("assertCssBalanced rejects a missing or extra brace and empty input", () => {
  assert.throws(() => assertCssBalanced("open", "a { color: red;"));
  assert.throws(() => assertCssBalanced("close", "a { } }"));
  assert.throws(() => assertCssBalanced("empty", ""));
});

test("assertNoRemoteLoads flags http, https and @import", () => {
  assert.doesNotThrow(() => assertNoRemoteLoads("ok", "a { color: red } // local only"));
  assert.throws(() => assertNoRemoteLoads("http", "fetch('http://x.test')"));
  assert.throws(() => assertNoRemoteLoads("https", "url(HTTPS://x.test/a.png)"));
  assert.throws(() => assertNoRemoteLoads("import", "@import 'a.css';"));
});

test("assertSingleApiHandle requires exactly one acquireVsCodeApi call", () => {
  assert.doesNotThrow(() => assertSingleApiHandle("one", "const v = acquireVsCodeApi();"));
  assert.throws(() => assertSingleApiHandle("none", "const v = 1;"));
  assert.throws(() => assertSingleApiHandle("two", "acquireVsCodeApi(); acquireVsCodeApi();"));
});

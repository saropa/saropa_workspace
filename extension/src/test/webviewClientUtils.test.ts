// Unit tests for the webview client JS-source generators (views/webviewClientUtils.ts)
// against their host-side twins (utils/escapeHtml.ts, utils/formatBytes.ts). The
// generators return the FUNCTION BODY as a string, interpolated verbatim into a
// webview's <script> template because the browser-sandboxed client cannot `import` a
// normal TS module (see webviewClientUtils.ts's header comment, BUG-012). That split
// means the two copies of each algorithm can only be kept honest by evaluating the
// generated JS text and comparing its output to the host function for the same
// fixtures — a plain diff of the source would not catch a semantic drift (e.g. a
// threshold typo that still "looks the same"). `new Function` evaluates the generated
// source in an isolated scope (no closures over this module), which is safe here
// because the source is our own literal, not external input (#55, #58).

import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtmlJs, formatBytesJs } from "../views/webviewClientUtils";
import { escapeHtml } from "../utils/escapeHtml";
import { formatBytes } from "../utils/formatBytes";

// Evaluates a generator's returned function-declaration source and returns the
// callable function, so a test can invoke it exactly as a webview's inline <script>
// would invoke its own copy.
function compile(fnName: string, source: string): (...args: unknown[]) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: this
  // compiles our own generated-JS-text fixture, not external/user input (see header).
  return new Function(`${source}\nreturn ${fnName};`)() as (...args: unknown[]) => unknown;
}

// --- escapeHtml host vs. webview-client JS parity (#55, #58) --------------

test("escapeHtmlJs matches escapeHtml for every HTML-significant character", () => {
  const clientEscape = compile("esc", escapeHtmlJs("esc"));
  // Fixtures cover: each of the five escaped characters individually, a string with
  // all five combined (order matters for a regex-replace bug), and plain text that
  // must pass through unchanged.
  const fixtures = [
    "&",
    "<",
    ">",
    '"',
    "'",
    `<script>alert("x")</script>&'`,
    "plain text, no escaping needed",
    "",
  ];
  for (const value of fixtures) {
    assert.equal(
      clientEscape(value),
      escapeHtml(value),
      `escapeHtmlJs("${value}") diverged from escapeHtml`
    );
  }
});

test("escapeHtmlJs matches escapeHtml's null/undefined guard", () => {
  // escapeHtml() (host) is typed to require a string, so its null/undefined behavior
  // is only observable through the JS-text twin, which is deliberately more permissive
  // (`s == null ? '' : s`) because a webview message payload is untyped JSON. Assert
  // the JS twin's guard produces the same empty-string result the host's contract
  // implies for "no value" (an empty string escapes to itself).
  const clientEscape = compile("esc", escapeHtmlJs("esc"));
  assert.equal(clientEscape(null), escapeHtml(""));
  assert.equal(clientEscape(undefined), escapeHtml(""));
});

// --- formatBytes host vs. webview-client JS parity (#58) -------------------

test("formatBytesJs matches formatBytes across unit boundaries", () => {
  const clientFormat = compile("fmt", formatBytesJs("fmt"));
  // Fixtures mirror formatBytes.test.ts's coverage: zero/whole bytes, the
  // one-decimal-under-100 scaling, and the decimal-drop at/above 100 of a unit.
  const fixtures = [0, 512, 1023, 1024, 1536, 250 * 1024, 20 * 1024, 1024 * 150, 5 * 1024 * 1024];
  for (const bytes of fixtures) {
    assert.equal(
      clientFormat(bytes),
      formatBytes(bytes),
      `formatBytesJs(${bytes}) diverged from formatBytes`
    );
  }
});

test("formatBytesJs matches formatBytes's non-finite guard", () => {
  const clientFormat = compile("fmt", formatBytesJs("fmt"));
  for (const bytes of [NaN, Infinity, -Infinity, -1, 0]) {
    assert.equal(
      clientFormat(bytes),
      formatBytes(bytes),
      `formatBytesJs(${bytes}) diverged from formatBytes`
    );
  }
});

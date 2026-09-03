// JS-source generators for helpers every webview CLIENT script needs but cannot
// `import`: a webview script is plain JS embedded as a template-string literal inside
// a host-side TS file (see esbuild.js — the bundler's one entry point is
// src/extension.ts; nothing under the browser-sandboxed webview ever passes through a
// bundler or module loader). That ruled out a normal shared module for the four
// hand-duplicated copies each of escapeHtml and byte-formatting (BUG-012); the fix
// that respects the sandbox is to author the helper's source text ONCE here and
// string-interpolate it into each webview's script template, instead of retyping the
// same function body in every panel.

// Escape the five HTML-significant characters. `fnName` lets each call site keep its
// existing local function name (some panels call it `esc`, others `escapeHtml`) so no
// call site elsewhere in that panel's script needs renaming.
export function escapeHtmlJs(fnName: string): string {
  return `function ${fnName}(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
  });
}`;
}

// Human-readable byte size (binary 1024 units). Mirrors utils/formatBytes.ts's
// algorithm exactly (decimal below 100 of a unit, whole number at/above) so a size
// reads the same whether it was formatted host-side or in this client script; kept as
// a separate JS-text copy only because the client cannot import that module.
export function formatBytesJs(fnName: string): string {
  return `function ${fnName}(bytes) {
  // Mirror the host-side NaN/Infinity guard in utils/formatBytes.ts: Number.isFinite
  // rejects NaN, +/-Infinity, and non-number types without the coercion that global
  // isFinite() applies (global isFinite("123") is true, Number.isFinite("123") is not).
  if (!Number.isFinite(bytes) || bytes <= 0) { return '0 B'; }
  var units = ['B','KB','MB','GB','TB'];
  var exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  var value = bytes / Math.pow(1024, exponent);
  return value.toFixed(value >= 100 || exponent === 0 ? 0 : 1) + ' ' + units[exponent];
}`;
}

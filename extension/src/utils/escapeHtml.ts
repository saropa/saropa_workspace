// Canonical HTML escaper for host-side markup assembly (webview shell HTML built as
// TypeScript template strings, and the Morning Brief static HTML export). Escapes all
// five HTML-significant characters so a value is safe in an HTML text node AND inside
// a double-quoted attribute. Centralized because this exact function (or a near-miss —
// some copies skipped the apostrophe) was hand-duplicated across ~8 files (BUG-012):
// every host-side webview shell needs the same guarantee, and a copy that drifts (an
// unescaped character) is a markup-injection hole, not just untidy code.
//
// Note: this is for HOST-side TypeScript, which can `import` normally. Webview CLIENT
// scripts cannot (see src/views/webviewClientUtils.ts) — they are plain JS embedded as
// template strings with no bundler pass, so they get a separate JS-source-text sibling
// of this same algorithm instead.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

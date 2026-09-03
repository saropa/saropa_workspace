# BUG-012: Multiple utility functions duplicated across the codebase

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Tree View / UX
File(s): Multiple (see details below)
Severity: Low
Extension version: 1.6.12

---

## Summary

Several utility functions and code blocks are duplicated across the codebase, violating the single-source-of-truth principle:

1. **`esc()`/`escapeHtml()` HTML-escaping** — duplicated across approximately 6 webview files: `configureRunShell.ts`, `customizePanel.ts`, `scheduleEditorShell.ts`, `setParamsPanel.ts`, `settingsPanel.ts`, `launcherViewShell.ts`.

2. **CSS design-token `:root` block** — copy-pasted near-verbatim across 5 asset/webview files.

3. **Byte-formatting functions** — 4 near-identical implementations: `metricFormat.ts`, `bloatScan.ts`, `processPoll.ts`, `projectStats.ts`.

4. **Glob-to-regex implementations** — 2 separate implementations: `exec/globMatch.ts` (dedicated module) and an inline version in `hygieneScan.ts`.

---

## Attribution Evidence

All files listed are in `extension/src/`. These are internal extension utilities, not third-party code.

---

## Reproducer

1. Search for `escapeHtml` or `esc` function definitions across `extension/src/` — find 6 copies.
2. Search for `:root` CSS variable blocks in webview/asset files — find 5 near-identical copies.
3. Search for byte/size formatting logic — find 4 implementations with minor variations.
4. Compare `exec/globMatch.ts` with the inline glob-to-regex in `hygieneScan.ts` — functionally equivalent.

**Frequency:** Always — this is a code-quality issue, not a runtime bug.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Each utility exists in one place and is imported where needed. CSS design tokens live in one shared stylesheet or template. |
| **Actual** | Multiple copies of functionally identical code scattered across the codebase, leading to maintenance burden and risk of divergence. |

---

## State / Flow Context

```
HTML escaping:
  configureRunShell.ts  → esc()
  customizePanel.ts     → esc()
  scheduleEditorShell.ts → esc()
  setParamsPanel.ts     → esc()
  settingsPanel.ts      → esc()
  launcherViewShell.ts  → esc()

CSS design tokens:
  5 asset/webview files → near-identical :root blocks

Byte formatting:
  metricFormat.ts   → formatBytes()
  bloatScan.ts      → formatSize()
  processPoll.ts    → formatBytes()
  projectStats.ts   → formatSize()

Glob-to-regex:
  exec/globMatch.ts    → globToRegex()
  hygieneScan.ts       → inline glob-to-regex
```

---

## Root Cause

These utilities were written independently in each module rather than extracted to a shared location. Some duplication arose from webview scripts needing to be self-contained (they run in a sandboxed iframe and cannot import from the extension host), but:
- The byte-formatting and glob-to-regex duplicates are in host-side code that CAN share imports.
- The CSS tokens could be generated from a single template.
- The HTML escaping could be a shared webview utility injected into all webview scripts.

---

## Suggested Fix

1. **HTML escaping**: Extract a single `escapeHtml()` function to a shared webview utilities module (e.g. `views/webviewUtils.ts`). Since webview scripts are bundled, the function can be imported at build time. Alternatively, inject it once in the shared webview HTML template.

2. **CSS design tokens**: Extract the `:root` block to a single template string or file. Generate or inject it into each webview from one source.

3. **Byte formatting**: Extract to a single shared utility in a common module (e.g. `utils/formatBytes.ts`). Update all four call sites to import from there.

4. **Glob-to-regex**: Remove the inline implementation in `hygieneScan.ts` and import from `exec/globMatch.ts`.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Grep confirms no remaining duplicated implementations
- [ ] Manual smoke test: all webviews render correctly, byte formatting displays correctly, glob matching works

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): n/a
- Settings Sync enabled (yes / no): n/a

---

## Reflection

### Hardening items

- **Glob-to-regex duplication (item 4), now closed.** `hygieneScan.ts` no longer defines its
  own copy of the wildcard-translation logic: it imports the canonical `translateGlobBody()`
  from `exec/globMatch.ts` and its local wrapper was renamed from `globToRegExp` to
  `excludeGlobToRegex` so it can never be mistaken for globMatch's own `globToRegExp`. The
  two wrapper functions still anchor differently on purpose — this scanner's excludes match
  gitignore-style at any path depth, while globMatch's globs anchor the full relative
  path — so a single shared wrapper function was never correct; only the wildcard body
  (`*`, `**`, `?`, escaping) needed to be, and now is, single-sourced.
- **Client/host escaper parity is manual, not enforced.** `utils/escapeHtml.ts` (host TS)
  and `escapeHtmlJs()` in `views/webviewClientUtils.ts` (client JS-text twin) must stay
  byte-for-byte equivalent by convention only — there is no test asserting the two escape
  the same characters the same way. A future edit to one (e.g. adding backtick escaping
  for a template-literal context) can silently desync from the other.
- **`escapeHtmlJs`/`formatBytesJs` are generated JS text, untyped by `tsc`.** Because they
  are string templates interpolated into webview HTML, a typo in the generated function
  body (e.g. in the character map `({ '&':'&amp;', ... })[c]`) would not be caught by
  `tsc -p ./ --noEmit` — only a runtime smoke test of an affected webview would surface it.
- **`formatBytes()` has no explicit `NaN`/`Infinity` guard.** `bytes <= 0` returns early for
  negative and zero values, but `NaN <= 0` is `false`, so `formatBytes(NaN)` falls through
  to `Math.log(NaN)` and produces `"NaN B"` (or similar) rather than a defined fallback.
  Same for `Infinity`, which resolves to `"Infinity TB"` after clamping the exponent.
- **Migration completeness across the 15 files touched is not verified by grep alone.**
  The grep for `formatBytes(`/`escapeHtml(` matches both the new canonical definitions and
  their call sites in 15 files; nothing in the repo confirms every one of the original six
  `esc()` webview duplicates and four byte-formatting duplicates was actually replaced with
  an import rather than left as a second, now-redundant local copy.

### Suggestions

- Add a unit test that runs `escapeHtmlJs('esc')` and `formatBytesJs('fmt')` bodies
  (via `eval` or `new Function`) against the same fixture inputs as `escapeHtml()` and
  `formatBytes()` in `utils/escapeHtml.ts` / `utils/formatBytes.ts`, asserting identical
  output — turns the "must stay in sync" comment into an enforced contract.
- Give `formatBytes()` an explicit `Number.isFinite(bytes)` guard returning a fixed
  fallback (e.g. `"0 B"`) for `NaN`/`Infinity`, and mirror the same guard in
  `formatBytesJs()` so a bad metric value renders identically on both sides.

# BUG-003: Planner webview has dozens of hardcoded English strings with no l10n bridge

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Tree View / UX
File(s): `extension/src/views/plannerScriptCore.ts`, `plannerScriptTimeline.ts`, `plannerScriptWorkflow.ts`, `plannerScriptInspector.ts`
Severity: High
Extension version: 1.6.12

---

## Summary

The entire Planner client-side script (spread across `plannerScriptCore.ts`, `plannerScriptTimeline.ts`, `plannerScriptWorkflow.ts`, and `plannerScriptInspector.ts`) contains dozens of hardcoded English strings — button labels, headings, status text, tooltips — with no `STRINGS` object or `l10n` bridge. Every other webview in the codebase injects a host-localized `STRINGS` object from the extension host. This is a direct violation of the project's hard i18n rule that no user-facing string may be hardcoded.

---

## Attribution Evidence

All four files live under `extension/src/views/` and are part of the Planner webview panel. The i18n pattern (injecting a `STRINGS` object from the host into the webview) is established in every other webview in the same directory.

---

## Reproducer

1. Open any of the four Planner script files.
2. Search for quoted English strings (button labels, headings, status messages).
3. Observe: strings are inline literals, not references to a `STRINGS` object.
4. Compare with any other webview script in the same directory — those use `STRINGS.someKey`.

**Frequency:** Always — the entire Planner surface is unlocalized.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | Planner webview strings are externalized through the same `STRINGS` injection pattern used by all other webviews, with values sourced from `locales/en.json`. |
| **Actual** | All Planner strings are hardcoded English literals in the client scripts. |

---

## State / Flow Context

```
plannerPanel.ts (host side)
  └─ builds webview HTML, injects scripts
      └─ plannerScriptCore.ts        ← hardcoded strings
      └─ plannerScriptTimeline.ts    ← hardcoded strings
      └─ plannerScriptWorkflow.ts    ← hardcoded strings
      └─ plannerScriptInspector.ts   ← hardcoded strings

Other webviews (e.g. settingsPanel, customizePanel):
  └─ host injects STRINGS object from l10n
      └─ client script references STRINGS.key   ← correct pattern
```

---

## Root Cause

The Planner webview was built without following the established i18n pattern. The host-side panel does not construct and inject a `STRINGS` object, and the client-side scripts use inline English literals instead of referencing externalized keys.

---

## Suggested Fix

1. Add all Planner user-facing strings to `src/i18n/locales/en.json` with appropriate keys.
2. In the Planner host panel (`plannerPanel.ts`), construct a `STRINGS` object from the l10n catalog and inject it into the webview HTML, matching the pattern used by other panels.
3. Replace all hardcoded string literals in the four Planner script files with `STRINGS.keyName` references.

This is a sizable change touching all four script files plus the host panel and the locale file.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Grep the four Planner script files — no remaining hardcoded English display strings outside `STRINGS.*`
- [ ] Manual smoke test: open the Planner panel, confirm all labels and messages render correctly

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

- **No compile-time link between `STRINGS.*` usages and `uiStrings()`.** The fix wires
  `plannerScriptCore.ts`, `plannerScriptTimeline.ts`, `plannerScriptWorkflow.ts`,
  `plannerScriptInspector.ts`, and `plannerAssets.ts` through the object literal
  returned by `uiStrings()` in `plannerPanelShell.ts`, but nothing enforces that set
  matches at build time. A future edit that adds `STRINGS.newKey` to a client script
  without adding the matching field to `uiStrings()` (and the `planner.*` entry in
  `en.json`) will not fail `tsc` or `esbuild` — `STRINGS` is untyped (`const STRINGS =
  ${strings}` in the injected `<script>`), so the miss only shows up as `undefined`
  rendered into the DOM, caught by manual smoke test at best.
- **Silent-junk fallback in `l10n()`** (`extension/src/i18n/l10n.ts:16`): a missing
  catalog key returns the raw key string (`catalog[key] ?? key`) instead of failing
  loudly. Combined with the point above, a typo in one of the ~60 `planner.*` keys
  passed to `l10n()` inside `uiStrings()` renders literal text like
  `planner.action.foo` in the Planner UI rather than surfacing as a build error.
- **Cross-catalog coupling for weekday labels.** `uiStrings().weekdayShort` reuses
  `scheduleEditor.weekday.0`..`6` rather than adding planner-scoped keys (correct
  per the single-source-of-truth rule), but this means a rename or restructure of
  the `scheduleEditor.weekday.*` keys in `en.json` — done for the schedule editor,
  without awareness of the Planner — will silently break the Planner's day/week
  headers. No test or comment at the `scheduleEditor.weekday.*` declaration site
  flags that the Planner also depends on it.
- **`uiStrings()` is built once per `renderShell()` call.** If a user changes VS
  Code's display language while the Planner panel is already open, the injected
  `STRINGS` object is stale until the panel is closed and reopened — same pattern
  as other webviews in this codebase, but worth confirming is an accepted
  limitation rather than an oversight, since the Planner is a longer-lived panel
  than most (timelines/workflow graphs invite leaving it open).
- **`howtoStep1`/`howtoStep2`/`howtoStep3` carry raw `<b>` markup** in `en.json`
  (e.g. `"<b>Drag a shortcut</b> from the shelf onto a step to chain it"`) and are
  presumably injected via `innerHTML` in `plannerScriptWorkflow.ts`. That's fine
  for a static, developer-authored English string, but it sets a precedent: if a
  future translated locale file is contributed by someone unfamiliar with this
  convention, unescaped `<`/`>` in a translated value could break the markup or
  (if a value is ever concatenated with untrusted user data instead of a fixed
  literal) open an injection path. Worth a one-line comment at the `howtoStep*`
  keys noting they are intentionally HTML-bearing.

### Suggestions

- Add a lightweight build-time or test-time check (a small Node script under
  `extension/src/test/`, run via the existing `node --test` harness) that parses
  each `plannerScript*.ts` / `plannerAssets.ts` file for `STRINGS\.(\w+)` and
  asserts every match is a key returned by `uiStrings()` in
  `plannerPanelShell.ts`, and that every `planner.*` key in `en.json` is
  referenced from at least one `l10n()` call — this generalizes past the Planner
  to any current or future webview using the same injection pattern, catching the
  exact failure mode this bug fixed and preventing regression.
- Consider making `l10n()` collect missing-key lookups in a dev/debug build (e.g.
  log a `console.warn` the first time a key falls through to the `?? key`
  fallback) so a typo surfaces during a manual smoke test instead of requiring
  the tester to notice a raw dotted key string among real UI text.
- Document the `scheduleEditor.weekday.*` → Planner dependency inline at the
  `uiStrings().weekdayShort` line (already partially done via the existing
  comment) and, symmetrically, add a short comment at the
  `scheduleEditor.weekday.*` declarations in `en.json` noting the Planner also
  consumes them, so the reuse is visible from either direction.

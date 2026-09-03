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

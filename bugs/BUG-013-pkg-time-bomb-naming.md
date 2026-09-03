# BUG-013: "Time-Bomb" terminology in shortcut expiry submenu label

**Status: Open**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Packaging
File(s): `extension/package.json` (submenu label), `extension/package.nls.json`
Severity: Low
Extension version: 1.6.12

---

## Summary

The submenu label for shortcut expiry reads "Shortcut Expiry (Time-Bomb)". The term "Time-Bomb" has strong negative connotations — it is associated with malware, destructive payloads, and hostile software behavior. This is inappropriate for a user-facing label in a Marketplace extension. The feature simply auto-removes a shortcut after a set duration and should be labeled accordingly.

---

## Attribution Evidence

The label is declared in `extension/package.json` under `contributes.submenus` and/or `extension/package.nls.json`. Extension manifest content.

---

## Reproducer

1. Right-click a shortcut in the tree view.
2. Look for the expiry submenu.
3. Observe: the label reads "Shortcut Expiry (Time-Bomb)".

**Frequency:** Always — this is a static label in the manifest.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | The submenu label uses neutral, professional terminology such as "Shortcut Expiry", "Auto-Remove", or "Temporary Shortcut". |
| **Actual** | The label includes "(Time-Bomb)" — a term with destructive/malware connotations. |

---

## State / Flow Context

```
package.json or package.nls.json
  └─ submenu.expiry.label = "Shortcut Expiry (Time-Bomb)"
      └─ displayed in the tree view context menu
```

---

## Root Cause

The label was written with a colloquial/informal term that was not reviewed for its connotations in a published extension context. "Time-bomb" is a common informal term among developers for time-limited features, but it carries negative associations for end users and in the Marketplace context.

---

## Suggested Fix

Rename the submenu label to one of:
- "Shortcut Expiry" (drop the parenthetical entirely)
- "Auto-Remove After..."
- "Temporary Shortcut"

Update in `package.nls.json` (since manifest strings use `%key%` externalization) and any corresponding key in `package.json`.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: right-click a shortcut, confirm the submenu label uses the updated text

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): both
- Settings Sync enabled (yes / no): n/a

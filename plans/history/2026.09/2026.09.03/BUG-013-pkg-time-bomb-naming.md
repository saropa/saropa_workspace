# BUG-013: "Time-Bomb" terminology in shortcut expiry submenu label

**Status: Fixed**

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

Renamed the label in `extension/package.nls.json` (`submenu.expiry.label`) from "Shortcut Expiry (Time-Bomb)" to "Shortcut Expiry" (dropped the parenthetical entirely, per the first suggested option). `package.json` itself already referenced the label only via `%submenu.expiry.label%`, so no change was needed there.

Also swept every other file for the informal "Time-Bomb"/"time-bomb"/"time-bombed" terminology and reworded it to neutral "expiry" language, since the term appeared throughout code comments and one other user-facing string, not just the submenu label:

- `extension/src/i18n/locales/en.json`: `expiry.autoUnsupported` reworded from "cannot be time-bombed" to "cannot have an expiry set".
- `docs/FEATURES.md`: dropped "(Time-Bomb)" from the Shortcut Expiry bullet and reworded "bombed shortcut" / "time-bombed" to "shortcut with expiry set" / "explicitly set an expiry on".
- Code comments in `extension/src/exec/gitBranch.ts`, `extension/src/exec/shortcutExpiry.ts`, `extension/src/commands/shortcutConfigCommands.ts`, `extension/src/model/shortcutStoreRestore.ts`, `extension/src/model/shortcut.ts`, `extension/src/model/shortcutStoreFieldUpdates.ts`, `extension/src/extension.ts`, `extension/src/test/configureExpiry.test.ts`, `extension/src/test/gitBranch.test.ts`, `extension/src/test/shortcutStoreMutation.test.ts`, `extension/src/views/shortcutRowDescription.ts`, `extension/src/views/shortcutRowFormatting.ts`, `extension/src/views/shortcutRowTokens.ts`, `extension/src/views/shortcutsTreeProvider.ts`, `extension/src/views/shortcutRowTooltip.ts` — no code identifiers or logic changed, comment text only.

Left untouched as historical records (not corrected retroactively): `CHANGELOG_HISTORY.md`, `plans/MASTER_PLAN.md` (tracks this bug by its original name), and `plans/history/2026.06/2026.06.25/PLAN_03_branch_linked_pins.md` / `PLAN_09_time_bomb_pins.md`.

---

## Verification

- [x] `tsc -p ./ --noEmit` clean
- [x] `npm run build` (`node esbuild.js`) succeeds
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

---

## Reflection

### Hardening items

- **Historical docs still say "Time-Bomb" and could resurface in search/Marketplace indexing.** `CHANGELOG_HISTORY.md`, `plans/MASTER_PLAN.md`, and `plans/history/2026.06/2026.06.25/PLAN_03_branch_linked_pins.md` / `PLAN_09_time_bomb_pins.md` were deliberately left untouched as historical records (per the "Changes Made" note above), but `CHANGELOG_HISTORY.md` ships as a tracked file — confirm it is not bundled into the `.vsix` (check `.vscodeignore`) since it is a public surface per the "No AI on public surfaces" / naming rules, even though the term itself isn't an AI reference.
- **Command IDs and the submenu ID were already neutral** (`saropaWorkspace.clearPinExpiry`, `saropaWorkspace.expirySubmenu` in `extension/package.json` lines 623, 994) — no renamed identifiers were needed, so there's no risk of a stale ID in `keybindings` or `menus` contributions pointing at a removed command. Verified by grep; no further action needed here.
- **No automated regression check for the string.** Nothing in `extension/src/test/**` asserts the submenu label or `expiry.autoUnsupported` text no longer contains "time-bomb" / "bombed" — a future edit (e.g. a copy-paste from the old PLAN_09 doc when someone re-reads it for feature history) could reintroduce the term without any test catching it.
- **Marketplace listing text (README.md, package.json `description`) was not explicitly checked in this pass** for "Time-Bomb" — the sweep covered `docs/FEATURES.md` and code comments but the "Attribution Evidence" section only names `package.json`/`package.nls.json` as the direct source; worth a final grep of `README.md` and `CHANGELOG.md` before the next publish to be certain no marketing copy still uses the term (CHANGELOG.md line 68 already correctly describes the rename, not a leftover use).

### Suggestions

- Add a one-line assertion in an existing i18n/locale test (or a lightweight lint step in `scripts/publish.py`'s pre-package validation) that scans `package.nls.json` and `src/i18n/locales/en.json` for banned informal terms ("time-bomb", "time-bombed") so a regression is caught at build time rather than by manual sweep.
- When a plan doc like `PLAN_09_time_bomb_pins.md` is intentionally left with the old terminology as a historical record, add a one-line note at the top of that file (e.g. "Historical: superseded terminology, see BUG-013") so a future reader doesn't treat it as current guidance and copy the old term forward.

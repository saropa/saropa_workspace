# Hardening + unrequested features batch

Follow-up to the three quick-win implementations (multi-root attribution, badge
trend delta, stale roadmap marker). This batch addresses every item raised in the
QW1-3 handoff reflections and adds three unrequested features.

## Hardening (H1–H6)

1. **Masked shortcuts suppress folder tag** — both `buildShortcutRowDescription`
   and `buildShortcutTooltipLines` now guard `owningFolder` behind `!masked`, so
   a vault shortcut never leaks its owning workspace folder.
2. **Test false-match on "in " substring** — the row-description test split on
   the `" · "` delimiter and matched exact segments, replacing `.includes("in ")`
   which could false-positive on paths containing "in ".
3. **Document infos exclusion** — `badgeScore()` in `shortcutBadges.ts` carries a
   comment explaining why info-severity counts are excluded from the trend delta.
4. **Document N-1 previous-badge semantics** — `record()` carries a comment
   explaining why only one previous badge is kept (answers "did this run improve
   on the last one", not N-2).
5. **Grep for stale gap-table references** — confirmed no file in the repo
   references the removed competitive-gap table.
6. **Check competitive-landscape.md existence** — confirmed the file was removed
   during the 2026-06-25 roadmap consolidation; plan 2.1 updated accordingly.

## Unrequested features (UF1–UF3)

### UF1: ShortcutTreeItem options-object refactor

The 14-positional-parameter constructor was replaced with a named
`ShortcutTreeItemOptions` interface. All three call sites
(`buildShortcutItem`, `buildRecentItem`, `toShortcutItem`) updated. Fields are
self-documenting at call sites; future additions are safe (add an optional field,
no positional breakage).

### UF2: Inline badge delta on tree row

`formatBadgeDelta` output (e.g. `▼3`) was previously tooltip-only. It now
appears in the row description, slotted after the sweep badge lead and before the
state badge. Suppressed while running/stopping (same guard as badgeLead). Three
new tests: delta shown when badges differ, omitted with no previous badge,
omitted while running.

### UF3: Stale cross-reference checker script

Python script at `d:\tmp\check_stale_refs.py` scans all plan/doc markdown files
for links whose target file or anchor does not exist. Found 23 stale references;
the actionable ones (ROADMAP, CHANGELOG) were fixed in this commit. History-file
fossils (renamed pin* → shortcut*) are expected and informational.

## Docs

- CHANGELOG: added options-object refactor and inline delta entries.
- ROADMAP: removed stale links to `plans/README.md` and
  `plans/guides/competitive-landscape.md`.
- CHANGELOG: removed stale link to nonexistent `CHANGELOG_ARCHIVE.md`.
- PIN_BADGE_TREND plan: updated build-order step 1 to note row-description
  delta is now shipped.

## Finish Report (2026-07-27)

**Scope:** VS Code extension (TypeScript).

**Tests:** 1059 passing, 0 failing. Type-check clean (`npx tsc --noEmit`).
Bundle builds (`node esbuild.js`) verified earlier in the session.

**Review findings acted on:**
- Misattributed doc comment (owningFolder comment above previousBadge field) —
  reordered.
- CHANGELOG_ARCHIVE.md removal flagged — confirmed intentional (stale ref).

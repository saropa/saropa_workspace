# Launcher expanded-card and board-layout refinements

The Saropa Launcher's expanded card showed two Run buttons and left-aligned its
drawer actions, and the board mis-handled width: expanding one card stretched its
row-mates, the search input spanned the full Panel, and cards sat flush with the
pane edge under their group heading. This record covers a cluster of CSS-only
refinements to the launcher webview (`extension/src/views/launcherAssets.ts`) that
tidy the expanded state and fix the board's use of horizontal space.

## Finish Report (2026-06-27)

### Defects

1. **Duplicate Run on an expanded card.** The card head's compact play button
   (`.run`) stayed visible when a card expanded, alongside the drawer's full labeled
   Run button — two Run affordances on one card.
2. **Drawer actions left-aligned.** `.drawer-actions` sat under the leading
   name/path column rather than at the card's trailing edge.
3. **Cramped drawer.** The drawer had little vertical breathing room.
4. **Row stretching on expand.** The card grid used the CSS-grid default
   (`align-items: stretch`), so every card in a row matched the tallest. Expanding
   one card's drawer stretched all its row-mates to the same height.
5. **Cramped card padding.** Card content sat tight against the horizontal edges
   (`padding: 5px 7px`).
6. **Full-width search bar.** `.search` (icon + input + count) stretched across the
   very wide Panel because the input flexed without a cap.
7. **No group indent.** The card grid was flush with the pane's left edge, so cards
   did not read as belonging to the group header above them.

### Changes

All in `extension/src/views/launcherAssets.ts` (`LAUNCHER_STYLE`), CSS-only:

- `.card.expanded .run { display: none }` — hide the head play button when expanded
  so the drawer's labeled Run is the single run affordance.
- `.drawer-actions { justify-content: flex-end }` — right-align Open/Run at the
  card's trailing edge.
- Drawer spacing increased: `.drawer` margin-top 6px to 9px plus padding-top 2px;
  `.drawer-desc` bottom margin 7px to 10px and line-height 1.35 to 1.4.
- `.grid { align-items: start }` — each card sizes to its own content height, so an
  expanded card grows downward alone and its neighbors keep their natural height.
- `.card` horizontal padding 7px to 11px.
- `.search { max-width: 420px }` — cap the search group so it stays a compact
  cluster on the leading edge.
- `.group-body { padding-left: 20px }` — indent the card grid under the group
  heading (past the header chevron + glyph).

No hex literal introduced; all colors remain theme-bound, so the existing
"binds to a --vscode-* variable" and "no hardcoded hex" invariants still hold.

### Tests

`extension/src/test/launcherAssets.test.ts` gained five tests pinning the new CSS
invariants against regression: the expanded card hides the head run button; the
drawer actions are right-aligned; the grid uses `align-items: start`; the
`.group-body` is indented; and the `.search` group is width-capped. Full suite:
829 passing, 0 failing. Type-check (`npx tsc -p ./ --noEmit`) clean.

### Convention recorded

`plans/guides/STYLEGUIDE.md` (section 1.1a, Panel launcher) gained bullets for:
one Run affordance per state (head play when collapsed, labeled Run when expanded);
cards size to their own content (never stretch a row); the search bar is a compact
width-capped group; and the card grid is indented under its group heading. The
now-stale "always-visible play button" note was corrected.

### Files

- `extension/src/views/launcherAssets.ts` — the layout changes.
- `extension/src/test/launcherAssets.test.ts` — five new invariant tests.
- `CHANGELOG.md` — `[Unreleased]` Changed entries.
- `plans/guides/STYLEGUIDE.md` — conventions recorded.

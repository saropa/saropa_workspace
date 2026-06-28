# Launcher header: one-line summary, stat filters, scheduled-only recipe count

The Saropa Launcher Panel header stacked the project name over a separate counts
line, devoted excessive width to the search box, presented its per-pane counts as
inert text, and headlined a "recipes" count that tallied every detected recipe —
overstating how many were actually automated. The header now reads on a single
line with a narrower search box, each count is a one-tap pane filter, and the
recipes count reflects only scheduled recipes.

## Finish Report (2026-06-28)

### Scope

VS Code extension, TypeScript, plus docs. Files changed:

- `extension/src/views/launcherAssets.ts` — webview CSS + client script.
- `extension/src/views/launcherView.ts` — host: stat shape + scheduled-recipe count.
- `extension/src/i18n/locales/en.json` — `launcher.statRecipes` label value.
- `extension/src/test/launcherAssets.test.ts` — four new invariant tests.
- `plans/guides/STYLEGUIDE.md` — §1.1a header conventions.
- `CHANGELOG.md` — `[1.5.8]` entries.

No Dart, no dependency changes, no bug file closed.

### What changed and why

**One-line project block.** `.project` changed from a vertical column
(`flex-direction: column`, name over meta) to a single horizontal row
(`flex-direction: row; align-items: baseline`) so the folder name, version, and
counts read as one summary line. `.project-name` can ellipsize and `.project-meta`
clips (`min-width: 0`, meta `overflow: hidden; flex-wrap: nowrap`) before either
pushes the search box off the bar. `.head-bar` switched to `align-items: center`
so the single project line aligns against the search box.

**Narrower search.** `.search` cap dropped from `flex: 0 1 420px; max-width: 420px`
to `260px`, freeing horizontal room for the project summary the wider box crowded.

**Stat filters.** Each `LauncherStat` gained a `pane` field. The client renders a
stat as a `<button class="meta-item filter">` carrying that pane; clicking it sets
the new transient `activePane` to narrow the board to that pane's cards, and
clicking the active chip clears it. `applyFilter` now combines the pane filter with
the text needle — a card shows only when it matches both (`matchText && matchPane`)
— and the header search count scopes to the focused set (the active pane, else
mine + recipes), switching to the "{shown} of {total}" form whenever either
narrowing is engaged. The active chip keeps an `.active` highlight. The filter is
deliberately transient (it resets on reload, unlike the persisted collapse
posture) because a filter is a momentary focus. `renderHeader` clears a dangling
`activePane` when a data refresh removes its pane from the stat set, so the board
never stays narrowed to nothing.

**Scheduled-only recipe count.** `buildHeader` no longer counts every recipe-pane
item for the recipes stat. It counts recipes whose `schedule !== undefined` — the
same "is scheduled" signal `shortcutTreeItem` uses — and the label changed to
"{count} scheduled" with a clock glyph. A recipe is a recommendation, so the
headline now reports what is actually automated rather than the full detected set.
The Recipes pane still lists every detected recipe, and the chip filters the board
to it. Consequence of the omit-empty-bucket rule: when no recipe is scheduled, the
chip disappears, so there is no header chip to filter to the Recipes pane in that
state.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm test` (Node `--test`, pure-logic suite) — 863 pass, 0 fail, including four
  new launcher tests (project block one-row layout, filter-chip CSS, filter-chip
  active-state CSS, and the filter script wiring combining pane + text match).

The host module (`launcherView.ts`) imports `vscode` and is not unit-testable
under the Node runner; its `buildHeader` logic is verified by type-check and the
build. The webview CSS/script invariants are pinned by the asset tests. The
existing header assertions (`.search` max-width, `.head-bar` space-between/wrap,
`.project-name` ellipsis, `.meta-item.version` foreground) all still hold.

### Style guide

§1.1a was updated: the search cap value (420px → 260px), the project-block bullet
rewritten for the one-line layout, a new bullet for the stat-as-filter convention
and the scheduled-only recipes count, and the "header count stays {n} shortcuts"
bullet reconciled with the filter-scoped count.

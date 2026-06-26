# Plan: recommend more recipes, without popups

## Why

Recipes are auto-detected and shown in the Recipes view under category folders
(GitHub, Build & Run, Workspace, Scheduled, Process Monitor, Saropa Suite). Two
gaps:

1. The scheduled rituals (dawn lint sweep, dependency freshness, standup digest,
   etc.) seed **disabled** and sit in the Scheduled folder doing nothing until the
   user promotes one and turns its schedule on. Most users never discover them.
2. There is no "start here" surface — a new user sees the whole flat catalog with
   no sense of which few recipes are worth adopting first.

The goal is to **recommend as many useful recipes as possible — especially the
disabled scheduled rituals — without ever interrupting the user with a popup.**
The recommendation surface must be passive: the user opens it when curious, and it
never steals focus.

## Shipped now (foundation)

A **Recommended** shelf at the top of the Recipes view (a synthetic group,
collapsed by default). It shows pointer copies of the highest-value recipes for
THIS project, ranked:

1. every **disabled scheduled ritual** first (the primary "turn these on" nudge),
   then
2. a curated short list of high-value recipes the project actually has
   (`flutter.dance`, `boot`, `dev`, `test`, `lint`, `github.pr`, `github.home`,
   `deployed`).

Capped at 8 rows so it stays a short highlight, not a second copy of the catalog.
A pointer carries the same `recipeId` as its home-category row, so promoting or
removing a recommendation acts on the underlying recipe (sticky by id) exactly as
acting from its category folder would. No popups anywhere — the shelf is the whole
surface.

Selection logic: `selectRecommendedRecipes` in
`extension/src/model/shortcutStoreShared.ts` (pure, unit-tested). The shelf rows:
`buildRecommendedShortcuts` in `shortcutStoreRecipes.ts`. The group injection:
`shortcutStoreRefresh.ts`.

## Shipped (this change)

All four follow-on items are now implemented. The pure selection logic stays in
`selectRecommendedRecipes` (`extension/src/model/shortcutStoreShared.ts`), now
taking a `RecommendedSelectionOptions` object (`aggressive`, `adoptedRecipeIds`);
the shelf rows are built in `buildRecommendedShortcuts`
(`shortcutStoreRecipes.ts`). New convention recorded in the style guide §4.6
(passive discovery, never a popup; one confirming toast).

### 1. Ranking quality — demote already-adopted (DONE, scoped to "ran on demand")

A recipe the user has already RUN on demand is demoted from the curated/aggressive
picks via local telemetry (`adoptedRecipeIds` computed in
`buildRecommendedShortcuts` from `telemetry.count` on both the `recipe:` and
`recommend:` ids). Promoting a recipe was already handled — promotion adds the
recipeId to `removedRecipes`, which the build loop skips. **Disabled scheduled
rituals are deliberately NOT demoted by the "ran" signal**: running a ritual once
on demand does not turn its schedule on, which is exactly what the shelf exists to
prompt.

Recency/freshness and project-shape weighting were considered and NOT built — a
static, well-chosen list plus the demote-adopted signal is enough; those heuristics
remain open if evidence shows they are needed.

### 2. One-tap enable for scheduled rituals (DONE)

A recommended scheduled row carries an inline check action
(`saropaWorkspace.enableScheduledRecipe`): one click promotes AND enables the
schedule at its suggested time (`enableScheduledRecipe` in
`shortcutStoreMutation.ts`, sharing one private `promoteRecipeInternal` with the
plain promote), with a single confirming toast naming the ritual and its time
("Dawn lint sweep enabled — runs daily at 05:00"). The row gets a distinct
`shortcutRecommendScheduled` context value so only the shelf shows the enable
action; category recipe rows are unchanged. The scheduler re-arms off the refresh.

### 3. A gentle, gated, in-tree first-run hint (DONE)

A one-time welcome row ("New here? These are worth turning on.") is prepended to
the Recommended group as an inert comment row when it has at least one
recommendation. It is gated by a one-way `globalState` latch
(`RECOMMENDED_HINT_DISMISSED_KEY`, set on first expand of the group or on adopting
a recommendation), so it shows at most once and never as a popup. The recipe count
excludes it (annotation rows are filtered in `RecipesTreeProvider`).

### 4. "Recommend everything" power mode (DONE)

`saropaWorkspace.recommend.aggressive` (default off) lifts the cap and features
every disabled ritual plus every un-adopted recipe the project has. Read in
`recommendAggressive()` and passed into the selector.

## Hard constraints (apply to every phase)

- **No popups for discovery.** Notifications are reserved for confirming an
  explicit user action (e.g. "enabled X"), never for nudging.
- **The shelf is a highlight, not a duplicate catalog.** Keep it capped unless the
  user opts into aggressive mode.
- **Sticky removal is shared by `recipeId`.** A recipe the user removed never
  returns as a recommendation.
- **No double execution.** Recommended rows are pointers/recipes (not promoted
  shortcuts); disabled schedules do not fire. Promotion is the single adoption act.

## Finish Report (2026-06-26)

All four follow-on items are implemented on top of the existing Recommended-shelf
foundation; the plan is complete and archived to history.

### What changed

- **Selection (pure):** `selectRecommendedRecipes`
  (`extension/src/model/shortcutStoreShared.ts`) now accepts a
  `RecommendedSelectionOptions` object (`aggressive`, `adoptedRecipeIds`) instead of
  results alone. Disabled scheduled rituals are added through a path that bypasses
  the adopted-demotion filter (running a ritual on demand does not enable its
  schedule, so it stays the primary nudge); curated and aggressive picks honor the
  filter. Aggressive mode drops the cap and appends every remaining un-adopted
  recipe. A new `RECOMMENDED_HINT_DISMISSED_KEY` globalState key backs the first-run
  hint latch.
- **Shelf build:** `buildRecommendedShortcuts` (`shortcutStoreRecipes.ts`) computes
  `adoptedRecipeIds` from local telemetry (`telemetry.count` on both the
  home-category `recipe:` id and the shelf `recommend:` id), reads
  `recommendAggressive()` from configuration, and prepends a one-time inert comment
  row ("New here? These are worth turning on.") when the shelf has at least one real
  recommendation and the dismiss latch is unset. The hint carries `isRecipe: true`
  so it flows through `getRecipeShortcuts` (which filters on that flag) yet renders
  inert via its `comment` action.
- **One-tap enable:** `enableScheduledRecipe` (`shortcutStoreMutation.ts`) promotes a
  recommended scheduled ritual and turns its schedule on in one act, sharing a new
  private `promoteRecipeInternal` with the plain promote. The command
  `saropaWorkspace.enableScheduledRecipe`
  (`commands/shortcutManagementCommands.ts`) confirms with a single toast naming the
  ritual and its time. A distinct `shortcutRecommendScheduled` context value
  (`views/shortcutTreeItem.ts`, gated on `groupId === RECOMMENDED_GROUP_ID`) drives
  the inline check action and a context-menu entry in `package.json`; the Promote
  clause was widened to include it. The scheduler re-arms off the refresh
  `promoteRecipeInternal` fires.
- **Dismiss latch:** `dismissRecommendHint` (`shortcutStoreRecipes.ts`) is a one-way
  globalState write; called from `setGroupCollapsed` (`shortcutStore.ts`) on first
  expand of the Recommended group (no refresh, so the already-rendered hint stays
  visible that session) and from `promoteRecipeInternal` on adopt (which refreshes).
- **Count integrity:** `RecipesTreeProvider` excludes annotation rows from the
  recipe total and per-folder counts, so the transient hint never inflates them.
- **Setting:** `saropaWorkspace.recommend.aggressive` (default false) added to
  `package.json` configuration with a `package.nls.json` description.
- **Tests:** three cases added to `shortcutStoreShared.test.ts` (aggressive uncaps
  and features uncurated recipes; an adopted curated recipe is demoted; an adopted
  disabled ritual is not). Full unit suite: 774 pass.
- **Style guide:** §4.6 added — passive discovery lives in the tree, never a popup;
  a toast confirms an explicit action only.

### Verification

`npx tsc -p ./ --noEmit` clean; `node esbuild.js` builds; `npm run test:unit` 774
pass; all edited JSON validated. Host-dependent surfaces (tree context value,
menus, the enable command) are outside the `node --test` harness and were verified
by inspection and type-check.

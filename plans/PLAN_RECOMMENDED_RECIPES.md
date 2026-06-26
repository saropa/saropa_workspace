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

## Still to design (needs sign-off before building)

These are the larger moves the user flagged as "needs some planning." None should
ship without explicit agreement, because each touches ranking quality or adds a
new persisted surface.

### 1. Ranking quality — beyond a fixed curated list

The curated list is a hand-picked constant today. Options to make the shelf adapt:

- **Usage-aware ranking.** Demote recipes the user already promoted or ran; the
  telemetry layer (`exec/telemetry.ts`) already records runs by id. A recipe the
  user adopted no longer needs featuring.
- **Recency / freshness signals.** Feature `db.migrate` when a new migration file
  appears, `install` when the lockfile changed, `test` when tests last failed
  (the run-status registry knows the last outcome).
- **Project-shape weighting.** A Flutter project should rank `flutter.dance` and
  `flutter analyze` above generic openers; a library project should rank
  `registry.pub` / `store`.

Open question: how much signal is worth the complexity? A static, well-chosen list
may beat a fragile heuristic. Recommend starting with "demote already-adopted"
(cheap, high value) and stopping there until there is evidence more is needed.

### 2. One-tap enable for scheduled rituals

Today, adopting a scheduled ritual is two steps (promote, then enable the
schedule). For the shelf to deliver on "turn these on," add an **inline enable**
action on a recommended scheduled row: one click promotes AND enables the schedule
at its suggested time, with a single toast naming the ritual and its time ("Dawn
lint sweep enabled — runs daily at 05:00"). This is the only place a toast is
warranted, because it confirms a state change the user explicitly requested.

### 3. A gentle, gated, in-tree first-run hint (NOT a popup)

To get a new user to *notice* the shelf without a popup: a one-time welcome row
inside the Recommended group ("New here? These are worth turning on.") that
disappears once the user expands the group or adopts anything. Gated by a
`globalState` flag so it never reappears. Still zero modal/notification surface —
it lives in the tree.

### 4. "Recommend everything" power mode (opt-in setting)

A `saropaWorkspace.recommend.aggressive` setting that lifts the cap and features
every disabled ritual plus every un-adopted high-value recipe, for users who
explicitly want the full menu. Off by default; the capped shelf is the default
experience.

## Hard constraints (apply to every phase)

- **No popups for discovery.** Notifications are reserved for confirming an
  explicit user action (e.g. "enabled X"), never for nudging.
- **The shelf is a highlight, not a duplicate catalog.** Keep it capped unless the
  user opts into aggressive mode.
- **Sticky removal is shared by `recipeId`.** A recipe the user removed never
  returns as a recommendation.
- **No double execution.** Recommended rows are pointers/recipes (not promoted
  shortcuts); disabled schedules do not fire. Promotion is the single adoption act.

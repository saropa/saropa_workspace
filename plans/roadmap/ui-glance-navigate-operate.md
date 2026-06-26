# UI overhaul — glance, navigate, operate

A standing plan to take the Saropa Workspace sidebar to a 10/10 "easy to glance,
navigate, and operate" bar. Written against the verified code state (the row
builder in `extension/src/views/pinTreeItem.ts`, the view/menu contributions in
`extension/package.json`, and the three tree providers), not against an
idealized design.

## The standard

The user named three verbs. They are the acceptance criteria:

1. **Glance** — at rest, a new pane reader finds the one thing they want in a
   second. Low default visual load; one dominant signal per row; secondary detail
   demoted to hover/icon, not crammed into text.
2. **Navigate** — finding a pin, a recipe, or an action is fast and predictable.
   Clear hierarchy, search that works, no hunting through 20-item menus.
3. **Operate** — the common action on any row is obvious and one gesture away;
   rare actions are reachable but never compete with common ones for attention.

A surface is not done because it works. It is done when it meets all three.

## Why the current UI misses the bar

Grounded in the code as it stands today:

- **A.  Pin rows are over-dense.** `PinTreeItem` joins up to seven description
  segments with `·` — `badgeLead · badge · expiryChip · branchChip · detail ·
  metricText · tagChip` ([pinTreeItem.ts:188-198](../../extension/src/views/pinTreeItem.ts#L188-L198)).
  In the narrow sidebar this truncates unpredictably, so the eye cannot lock onto
  the one fact it came for. Fails **glance**.
- **B.  The Pins toolbar is overloaded.** The `view/title` `navigation` group
  shows roughly eight always-visible icon buttons (filter, mode, run-any, planner,
  add-group, refresh, restore-auto-pins, branch toggle), and the `···` overflow
  carries four more subgroups of ~20 items
  ([package.json:764-944](../../extension/package.json#L764-L944)). Primary actions
  (filter, run, new pin) compete with rare ones (save layout, restore auto-pins)
  for the same row. Fails **operate**.
- **C.  The signature interaction is invisible.** Single-click opens, double-click
  runs — the core gesture — has no on-screen affordance and no first-run teaching.
  A new user cannot discover it. Fails **operate** and **navigate**.
- **D.  Glyph and color use is ad hoc.** Icon and tint choices are decided inline
  across the row builder with no central token map, so "what does a yellow row /
  a star / a lock mean" is not learnable at a glance and not guaranteed
  consistent. Fails **glance**.
- **E.  Information architecture is unreviewed.** Three stacked tree views plus
  several status-bar items spend a tight vertical budget. Recipes is an
  always-present second view holding ~47 detected items. Whether that earns its
  permanent slot, versus a collapsible section, is an open IA question. Affects
  **glance** and **navigate**.

Phase 0 below (already shipped) attacks the cheapest part of A/E — default
visual load — by deferring secondary surfaces. The remaining phases are the
substantive work.

## Principles (apply to every phase)

- **Progressive disclosure.** Secondary surfaces start collapsed and lazy-load;
  the primary surface (the user's own pins) is always first and always visible.
- **One primary action per row**, obvious and one gesture away. Everything else
  lives in hover or the context menu.
- **Encode with icon + color before text.** A state that can be a glyph/tint
  should not also be a text chip. Text chips are the last resort, capped per row.
- **A documented token map is the single source of truth** for every glyph and
  tint, so the visual language is learnable and consistent (Code Quality:
  single source of truth).
- **Teach the model in the empty state**, not in docs the user never opens.
- **No silent async, name the item acted on** — unchanged from the global UX
  rules; this plan tightens density, it does not drop feedback.

## Phase 0 — Reduce default visual load (SHIPPED)

Cheapest glance win: stop secondary surfaces from spending the reader's
attention before they ask.

- Project Files view contributes `visibility: "collapsed"` — starts closed and
  its disk scan defers until first expand
  ([package.json:51-55](../../extension/package.json#L51-L55)).
- The Recent group defaults to collapsed
  ([telemetry.ts recentExpanded](../../extension/src/exec/telemetry.ts)); the
  user's expand gesture is still remembered.
- The Global Pins header is hidden while empty and unfiltered (no more
  always-on "Global Pins 0")
  ([pinsTreeProvider.ts getChildren](../../extension/src/views/pinsTreeProvider.ts)).
- Recipe category folders already defaulted to collapsed
  ([pinStore.ts recipeGroupExpanded](../../extension/src/model/pinStore.ts#L1756)) —
  verified, no change.

**Verification:** `tsc -p ./ --noEmit` clean; manual smoke in the dev host that a
fresh window opens with Pins front-and-center and the other surfaces folded.

## Phase 1 — Row legibility (attacks problem A)

Goal: a resting pin row shows at most the leading state signal, the name, and one
trailing detail. Everything else moves to hover or to an icon/tint.

- Define a **row description budget**: lead (running / next-run / last-run /
  lock / paused — already mutually exclusive) + detail (path or action summary).
  Branch, tag, metric, and expiry become hover lines and/or a single compact
  trailing icon, not inline `·`-joined text.
- Keep the existing mutual-exclusion logic for the lead badge; it is already
  correct. The change is to stop appending `branchChip`, `tagChip`, `metricText`,
  and `expiryChip` to the visible description unconditionally.
- Decision needed (see Open decisions): exactly which of branch / tag / metric /
  expiry keep a compact glyph on the row versus hover-only.

**Risk:** medium — touches the most-read code path and its unit test
(`pinTreeItem` row rendering). Behavior-test the new budget: assert the rendered
description has ≤ N segments for a pin carrying every optional signal.
**Verification:** `npm run test:unit` (the row test) + dev-host smoke against a
pin loaded with branch + tags + metric + expiry simultaneously.

## Phase 2 — Toolbar triage (attacks problem B)

Goal: ≤ 4 always-visible buttons on the Pins title bar; everything else in a
well-sectioned overflow.

- Keep visible: filter, run-any, add-pin/new, refresh. Demote planner,
  add-group, restore-auto-pins, save/restore layout, env profile, and the
  branch toggles into the `···` overflow (they already partly live there).
- Re-section the overflow with the existing group ids so related actions sit
  together and read as blocks, not a flat list.
- This is pure `package.json` `menus` work — no runtime code — so it is low risk
  and fully reversible.

**Risk:** low (manifest only). **Verification:** dev-host smoke; confirm every
demoted command is still reachable from the overflow and the palette.

## Phase 3 — Teach the interaction (attacks problem C)

Goal: a first-time user learns "single-click opens, double-click runs" without
reading anything external.

- Strengthen the three `viewsWelcome` bodies so the empty Pins view states the
  gesture model and the two ways to add a pin.
- A one-time hint (toast or inline) the first time a runnable pin exists,
  gated on a `globalState` "shown" flag (per the UX once-gate rule), naming the
  gesture. Never re-shown.
- Verify the gesture is also stated in a pin's hover so it is always one
  mouse-over away.

**Risk:** low. New l10n keys (routine, add as part of the change).
**Verification:** dev-host: fresh profile shows the welcome copy and the
one-time hint; second run does not.

## Phase 4 — Icon and color token map (attacks problem D)

Goal: one documented source for every glyph and tint the tree uses, so the
visual language is consistent and learnable.

- Extract the inline `ThemeIcon` / `ThemeColor` choices from the row builder
  into a single small module mapping state → (codicon, theme color), with a
  WHY comment per entry (what the state is, why the glyph).
- The row builder consumes the map; no call site invents a glyph or hex.
- Document the legend (what each glyph/tint means) in the extension README's
  Pins section so the language is teachable.

**Risk:** low-to-medium (a mechanical extraction across one file). **Verification:**
the row unit test still passes; a snapshot of glyph choices per state matches the
pre-extraction behavior (no visual regression).

## Phase 5 — Information architecture review (attacks problem E — DECISION GATE)

Not a code change yet — a decision to make with the user before building:

- Should **Recipes** stay an always-present second tree view, or fold into a
  collapsible section so the default sidebar is one primary view plus optional
  sections?
- Are all current **status-bar items** (pin-set switcher, schedule status,
  next-scheduled) earning their slot, or should some merge?
- Is the **Project Files** view better as a fourth view (current) or as a
  collapsed section under Pins?

This phase produces a recommendation + mockup, then waits for sign-off before
any contribution change (blast-radius: view containers are structural).

## Open decisions (need user input)

1. **Row budget contents (Phase 1).** Of branch / tag / metric / expiry, which
   keep a compact on-row glyph and which go hover-only? Recommendation: keep
   metric (it is the live value the user opted into) and a single expiry glyph
   on-row; move branch and tags to hover. Confirm or adjust.
2. **Recipes view fate (Phase 5).** Keep as a permanent second view, or make it
   a collapsible section? Recommendation: keep as a view but revisit after
   Phases 1-2 land, since a lighter row + toolbar may make the second view feel
   less heavy on its own.
3. **Scope and order.** Phases are independent enough to reorder. Recommendation:
   1 → 2 → 4 → 3 → 5 (legibility and toolbar give the biggest glance/operate
   gains first; the token map supports them; teaching and IA follow).

## Not in scope

- No new features, no new dependencies, no design-system primitives added
  without the blast-radius gate.
- No webview-panel redesign (Dashboard / Planner) — this plan is the sidebar
  tree surfaces; panels are a separate effort if raised.

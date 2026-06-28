# Launcher: collapsible major panes

The Saropa Launcher webview let a user fold inner groups but not the major
sections themselves, so a board with several populated panes (My shortcuts,
Recipes, Watches, Project files) could not be reduced to only the sections in
use. This change makes each pane independently collapsible, persists the fold
state across reloads, and keeps the surface responsive and search-aware.

## Finish Report (2026-06-28)

### Defect
Only inner groups carried a disclosure header (`makeGroup` built a clickable
`.group-head` with a chevron and toggled `.group.collapsed`). The pane head
(`.pane-head`) was a static `<div>` — title plus count, no affordance — so a
whole section could never be folded. A user wanting one section on screen had to
collapse every group inside the others one at a time.

### Change
Pane-level collapse added as a second, independent disclosure level, mirroring
the existing group mechanism.

- `extension/src/views/launcherAssets.ts` (CSS, `LAUNCHER_STYLE`):
  - `.pane-head` converted from a flex `div` to a full-width `<button>`
    (`background:none; border:none; cursor:pointer`), keeping the bottom divider
    and `align-items:center` for the new chevron.
  - Added `.pane-chevron` (rotates `-90deg` under `.pane.collapsed`),
    `.pane.collapsed .pane-body { display:none }` to fold the section while the
    head stays visible, and `.root.searching .pane .pane-body { display:block }`
    declared AFTER the collapsed rule so it wins at equal specificity — a query
    reveals matches inside a folded pane.
- `extension/src/views/launcherAssets.ts` (client script, `LAUNCHER_SCRIPT`):
  - `render()` now builds the pane head as a `<button>` with a `.pane-chevron`,
    title, and count, and wires a click that toggles `.collapsed` on the pane and
    persists it via `setCollapsed(paneKey, …)`.
  - Fold posture stored under `paneKey = 'pane:' + pane.id` in the same
    `getState`/`setState` `collapsed` map as groups; the `pane:` prefix prevents
    a pane id colliding with an inner group id.
  - Everything below the head wrapped in a new `.pane-body` div so one
    `.pane.collapsed` class folds the whole section (flat panes render their grid
    in the body; grouped panes render their groups in the body).
  - Module header comment updated to describe the two independent collapse
    levels.

### Responsiveness
The `repeat(auto-fit, minmax(340px, 1fr))` `.panes` track is unchanged; a
collapsed pane shrinks to its head and the panes still sit side by side when wide
and stack when narrow.

### Tests
Four tests added to `extension/src/test/launcherAssets.test.ts`:
- a collapsed pane folds `.pane-body` and rotates `.pane-chevron`;
- the `.root.searching` reveal rule is declared after the collapsed rule
  (source-order specificity guard);
- the script wires the pane-head toggle, the `'pane:' + pane.id` key namespace,
  and `setCollapsed(paneKey…)`.

Verification: `npx tsc -p ./tsconfig.json --noEmit` clean; `npm test` 849 pass /
0 fail; `node esbuild.js` builds.

### Convention recorded
`plans/guides/STYLEGUIDE.md` section 1.1a: the "Groups are collapsible" rule
rewritten to "Both panes and groups are collapsible" — documents the two
disclosure levels, the `pane:<id>` key namespace, the `.pane-body` wrapper, and
the search-reveal specificity ordering.

### Files
- `extension/src/views/launcherAssets.ts`
- `extension/src/test/launcherAssets.test.ts`
- `CHANGELOG.md`
- `plans/guides/STYLEGUIDE.md`

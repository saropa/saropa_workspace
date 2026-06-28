# Launcher file cards lead with Open, not Run

In the Saropa Launcher Panel webview, every shortcut card showed a blue Run (▶) button on its head regardless of type, so a pinned document (README, CHANGELOG, a Markdown file) presented Run as its primary affordance even though running a document has no sensible default. The head button now carries the card's primary action — Open for a file shortcut, Run for a non-file action — and the run-only-when-it-makes-sense intent is honored.

## Defect

`makeCard` in `extension/src/views/launcherAssets.ts` rendered the head button solely from `it.runnable`, always as a Run (▶) button posting a `run` message. Because `toItem` in `launcherItems.ts` marks every "My shortcuts" / "Recipes" card `runnable: true`, a document shortcut got a prominent Run button. The drawer then duplicated the action set (Open secondary, Run primary), and the head ▶ was hidden once the card expanded so the drawer could carry the single Run.

## Change

All in the launcher webview asset module (`launcherAssets.ts`) — the controller/host (`launcherView.ts`) and the pure data layer (`launcherItems.ts`) were not changed; the `runnable` / `openable` flags they emit are unchanged.

- The head button is now the card's primary action, chosen by `it.openable`: a file shortcut (`openable`) leads with **Open** (`go-to-file` icon, posts `open` via `postOpen`); a non-file action leads with **Run** (`play` icon, posts `run`). Gating stays on `it.runnable`, so the browse-only Watches and Project-files panes keep no head button (their deliberate expand-then-act model is preserved).
- The head button is icon-only while collapsed and grows a text label on expand via a `.run-label` span: `display: none` by default, `display: inline` under `.card.expanded`. The button stays visible in both states — the prior `.card.expanded .run { display: none }` hide rule was removed.
- No-duplicate-action is now enforced by the drawer omitting whatever the head carries, instead of hiding the head. The drawer renders Open only for browse-only panes (`it.openable && !it.runnable`) and Run only for file shortcuts (`it.runnable && it.openable`, as the secondary action). A non-file action card therefore shows Run on the head and nothing redundant below.

## Result

- A document card reads **Open** (head, blue) collapsed; expanding it shows the **Open** label on the head and **Run** in the drawer as secondary.
- An action card reads **Run** (head, blue), label revealed on expand, no duplicate below.
- Watches / Project-files cards are unchanged: no head button, Open in the drawer.

## Tests

`extension/src/test/launcherAssets.test.ts` — the assertion that an expanded card hid the head Run button (`.card.expanded .run { display: none }`) was replaced. The new test pins the new behavior: `.run-label` is hidden by default and revealed under `.card.expanded`, and the head button must NOT be hidden on expand. Scoped run of the file: 21 tests pass.

## Style guide

`plans/guides/STYLEGUIDE.md` section 1.1a — the "One Run affordance per state: head ▶ when collapsed, labeled Run when expanded" rule was superseded by "The head button carries the card's primary action; the drawer carries the rest," documenting the Open-for-files lead, the icon-only-then-labeled head, and the drawer-omits-the-head-action dedup.

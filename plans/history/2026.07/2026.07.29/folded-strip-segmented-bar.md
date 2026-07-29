# Folded strip: pills to connected segmented bar

The launcher webview's folded strip rendered each collapsed section as an
isolated rounded pill with its own border, full uppercase title, and a 6px gap
between neighbors. With several sections collapsed, the strip read as scattered
text buttons in dead space rather than a unified control.

## Finish Report (2026-07-29)

### What changed

The `.folded` container was restyled from a loose row of individually bordered
pills into a connected segmented bar:

- **Container owns the chrome.** The `.folded` div now carries the outer border,
  `border-radius: 6px`, and `overflow: hidden`, so the first and last visible
  segments get rounded corners automatically without fragile `:first-child` /
  `:last-child` selectors (hidden panes break those). `width: fit-content` hugs
  the segments instead of stretching full-width.
- **Segments sit flush.** Column gap set to zero; 1px dividers drawn via
  `.pane + .pane:not(.hidden)` border-left.
- **Icon + count only.** The `.pane-title` is clip-hidden
  (`clip-path: inset(50%)`, not `display: none`) so it remains the button's
  accessible name for screen readers and the existing tooltip. The chevron is
  also hidden (unchanged rule, updated comment).
- **Drop affordances switched to inset box-shadow** — segments have no
  individual borders to recolor. `.can-drop` and `.drop-over` now use
  `box-shadow: inset 0 0 0 1px var(--vscode-focusBorder)`.
- **Count styling tightened** inside the strip: `0.78em`, `font-weight: 600`.

### Files changed

| File | Change |
| --- | --- |
| `extension/src/views/launcherAssets.ts` | All CSS: bar container, flush segments, clip-hidden title, box-shadow affordances |
| `extension/src/views/launcher/launcherScriptFolded.ts` | Comment-only: pill references updated to segment/bar |
| `extension/src/test/launcherAssets.test.ts` | Three tests updated: strip container, segment styling, drop affordance assertions |
| `plans/guides/STYLEGUIDE.md` | Folded-strip convention rewritten for segmented bar |
| `CHANGELOG.md` (root) | Unreleased entry |

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm test` — 1080/1080 pass.
- Manual smoke test in dev host: not executed (requires F5 launch by the developer).

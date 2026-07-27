# Color-coded sweep delta + hardening round 2

A `FileDecorationProvider` tints file shortcut labels green (fewer issues) or
red (more issues) based on the ▲/▼ delta between the current and previous sweep
badge. The second hardening pass closes gaps surfaced by the prior handoff
reflection.

## FileDecorationProvider

`ShortcutDecorationProvider` (`views/shortcutDecorations.ts`) maps each file
shortcut's resolved URI to a delta direction (`improving` / `worsening`). It
uses `charts.green` and `errorForeground` ThemeColors, so the tint follows the
user's theme. The decoration is global (all views that show the same URI),
which is intentional: a file whose issues are worsening is worth highlighting
in the Explorer and open-editor tabs, not only the shortcut tree.

Masked shortcuts are excluded — the tint would leak trend direction about the
target, which contradicts the mask's purpose.

Non-file shortcuts (shell, url, command, macro) cannot participate because they
have no `resourceUri` for the provider to match against. This is a VS Code API
constraint, not a design gap.

Wired in `activation/wiringViews.ts` via `shortcutBadges.onDidChange` and
`store.onDidChange`. Both can fire for the same logical event (a run finishing),
causing two `refresh()` calls; VS Code coalesces the resulting repaint, so the
visual cost is zero — noted as a minor optimization candidate if badge-change
frequency grows.

## Hardening

- **Inconsistent optionality** — `previousBadge` in `ShortcutRowDescriptionInput`
  changed from `?:` (optional property) to `: T | undefined` (required but
  nullable), matching every other field in the interface.
- **Masked delta suppression** — the inline row delta was not gated on `!masked`.
  A masked shortcut with a sweep badge would leak whether issues were trending
  up or down. Added the guard and a test.
- **Delimiter contract** — documented the `" · "` join assumption: each segment
  formatter must never produce a value containing the delimiter.
- **Stale cross-reference checker** — the Python script now normalizes forward
  slashes to `os.sep` on Windows and skips GitHub-style line anchors (`#L123`).

## Finish Report (2026-07-27)

**Scope:** VS Code extension (TypeScript).

**Tests:** 1060 passing, 0 failing. Type-check clean (`npx tsc --noEmit`).

**Review findings:**
- Double-refresh on badge change acknowledged — VS Code coalesces, no fix needed.
- No unit tests for `ShortcutDecorationProvider` — requires VS Code host;
  the delta logic it calls (`formatBadgeDelta`, `shortcutKind`) is tested.

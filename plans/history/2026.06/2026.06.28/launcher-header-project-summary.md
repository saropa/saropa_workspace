# Launcher header: project summary on the leading edge, search moved to the trailing edge

The Saropa Launcher Panel header carried only a search box on the leading edge,
leaving the wide Panel's remaining width empty. The header is now a two-part bar:
a project summary (folder name, declared version, per-pane counts) on the leading
edge and the compact search group on the trailing edge.

## Finish Report (2026-06-28)

### Scope

VS Code extension, TypeScript. Files changed:

- `extension/src/views/launcherView.ts` — host: header computation + initial markup.
- `extension/src/views/launcherAssets.ts` — webview CSS + client script.
- `extension/src/i18n/locales/en.json` — header strings.
- `extension/src/test/launcherAssets.test.ts` — four new invariant tests.
- `plans/guides/STYLEGUIDE.md` — §1.1a header convention.
- `CHANGELOG.md` — `[Unreleased]` entries.

No Dart, no dependency changes, no bug file closed.

### What changed and why

**Layout.** The header markup gained a `.head-bar` wrapper — a `space-between`
flex row that puts a new `.project` block on the leading edge and the existing
`.search` group on the trailing edge. `.search` changed from `width: 100%;
max-width: 420px` to `flex: 0 1 420px; max-width: 420px` so it shrinks but never
grows to fill the freed width; the project block (`flex: 1 1 auto`) takes that
width instead. `.head-bar` wraps on a narrow Panel, dropping the search below the
project line so neither block is crushed.

**Project block.** `.project` shows the open folder's name (`.project-name`,
single-line, ellipsized) over a meta line (`.project-meta`) of the declared
version plus per-pane counts (shortcuts / recipes / watches / files). Each count
is an icon + value; an empty bucket is omitted so the line stays a tight summary.
The version reads in the regular foreground (the headline fact); the counts stay
in the dimmed description color.

**Synchronous name, asynchronous version + counts.** The project name is painted
in the initial HTML (`renderHtml` reads the first workspace folder synchronously)
so the header is never blank on first render. The version and counts arrive in the
first `data` message and are written by the client's `renderHeader`. The host's
`post()` was refactored so the project-files disk scan runs exactly once per paint:
its result feeds both the file cards and `buildHeader`'s version lookup, so the
new header adds no second scan. `buildAllItems` changed from an async method that
scanned internally to a synchronous method that takes the already-scanned file set.

**Version derivation.** `deriveProjectVersion` reads the version from the scanned
manifests in a fixed precedence — `package.json`, `pubspec.yaml`, `Cargo.toml`,
`pyproject.toml`, then `CHANGELOG.md` (its newest released heading) — so a polyglot
repo reports one stable version. It is scoped to the primary workspace folder so a
sibling folder's manifest in a multi-root workspace cannot leak in. Nothing
declared yields no version chip rather than an empty "v".

**Safety.** The folder basename is the one untrusted value interpolated into the
initial HTML string, so it is HTML-escaped (`escapeHtml`) before interpolation.
Every later header update goes through `textContent`, which escapes by
construction; the client script holds no display strings (all labels are
host-localized via `l10n` and posted in the `header` object).

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm test` (Node `--test`, pure-logic suite) — 857 pass, 0 fail, including the
  four new launcher-header tests (space-between bar, name ellipsis + version
  foreground, `renderHeader` wiring, and the retained search width cap).

The host module (`launcherView.ts`) imports `vscode` and is not unit-testable
under the Node runner; its logic is verified by type-check and by the build. The
webview CSS/script invariants it depends on are pinned by the asset tests.

### Style guide

§1.1a's "search on the leading edge" bullet was superseded by two new bullets:
the two-part header bar (project leads, search trails) and the project block's
content + synchronous-name / asynchronous-version-and-counts contract.

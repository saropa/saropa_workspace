# Plan — Onboarding and quick access

Filed from MASTER_PLAN items 5.2–5.6. Verified not started on 2026-11-20: no onboarding wizard, no recent-files quick-add, no status bar quick-run, no usage line in the tooltip, no `saropaWorkspace.externalTerminal` setting. Competitor context: [FAVORITES_COMPARISON.md](competitors/FAVORITES_COMPARISON.md).

## Q1. Onboarding wizard (was 5.2)

- **What:** new users see 6 sidebar views, a panel and 37+ settings with no guidance; the welcome view text is too long for its area.
- **How:** a single-page walkthrough on first activation: add your first file, run a script, explore recipes. Set `hasCompletedOnboarding` in globalState to suppress it after the first run, and add a command to reopen it.
- **Constraints:** prefer VS Code's native walkthrough contribution over a new webview (the Master Plan avoids adding webviews). All copy through `package.nls.json` and `l10n()`.

## Q2. Quick-add from recent files (was 5.3)

- **What:** a QuickPick of recently opened files with a one-key add-as-shortcut action.
- **Open question:** VS Code exposes no public MRU API. Source options: tab groups plus `onDidChangeActiveTextEditor` history kept by the extension, or the existing recent-list (see `history/2026.06/2026.06.26/recent-list-and-untapped-badge-on-open.md`). Decide before building.

## Q3. Status bar quick-run (was 5.4)

- **What:** a status bar item showing the top shortcut's name; click runs it, right-click opens the run palette.
- **Open questions:** definition of "top" (first in the tree, most-run, or user-chosen), and a setting to hide it.

## Q4. Usage analytics in the sidebar (was 5.5)

- **What:** run count and last-run time in the shortcut tooltip or description, so dead shortcuts are visible.
- **Note:** data exists in `telemetry.ts`; this is presentation only. Keep it local-only per [principles.md](guides/principles.md).

## Q5. Linux terminal emulator preference (was 5.6)

- **What:** `externalLauncher.ts` hardcodes the probe order `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm`.
- **How:** add a `saropaWorkspace.externalTerminal` setting (manifest string via `%key%`, description in `package.nls.json`). When set, use it; when unset or missing on PATH, fall back to the probe order and name the emulator used in the failure message.

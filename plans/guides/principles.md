# Principles

The standing design constraints for Saropa Workspace. These hold for every backlog item
under [`plans/`](../). A change that violates one of these is not done, no matter how
complete it looks.

- **Local-first.** All pin data lives on the user's machine — a project file in the repo
  and VS Code's own global state. Nothing requires a server, an account, or a network
  round-trip to function.
- **No remote telemetry.** The extension transmits and phones home nothing — no network
  round-trip, no crash beacons, no analytics SDK, ever. **Local** telemetry is allowed and
  expected: on-device usage counts, run tallies, and last-run times power features (smart
  suggestions, last-run status, local run analytics). All of it lives in `globalState`, is
  viewable and resettable by the user, can be disabled, and is **never** transmitted.
  Diagnostics stay in the local output channel.
- **Design-system-consistent UX — native-first, webview when justified.** Default to VS
  Code's native surfaces — tree view, QuickPick, input boxes, theme-aware product icons
  (`ThemeIcon`), markdown preview, and the integrated terminal. They are free, theme-aware,
  accessible, and read as a first-class part of the editor rather than a bolt-on. A custom
  webview is allowed where a native surface genuinely cannot do the job — a live chart, a
  sparkline trend, a sortable multi-column grid — but it is the exception that must earn its
  place, never the default reach. Any webview is **local-only**: a strict Content-Security-
  Policy with a per-load nonce, no external script or CDN, no network access of any kind, so
  it still satisfies the no-remote-telemetry principle. Use the theme CSS variables
  (`--vscode-*`) so a webview tracks the active color theme.
- **Translation-ready from the start.** Every user-facing string is externalized: manifest
  strings through VS Code's NLS `%key%` pipeline (`package.nls.json`), runtime strings
  through the `l10n()` helper and `src/i18n/locales/en.json`. No inline English in code,
  no English concatenation around dynamic parts — use `{token}` interpolation.
- **Forward-compatible data.** The on-disk schema is versioned (`ProjectPinsFile.version`).
  New fields are added without breaking older stored files; removals and renames go through
  a migration, never a silent drop.
- **Safe execution.** Running a pin is an explicit, visible act. Background and scheduled
  runs always surface an outcome (toast and/or output channel); nothing executes silently.

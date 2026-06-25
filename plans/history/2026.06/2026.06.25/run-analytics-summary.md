# Local run-analytics summary (roadmap 3.3)

The extension recorded local run telemetry (recents and a lifetime per-pin run
count) and a per-session background-run status, but offered no consolidated view
of that data beyond the Recent sidebar group's most-recent ordering. This adds an
on-demand summary that reads only those on-device stores and renders them as a
read-only Markdown preview.

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript). No Dart/Flutter code touched.

### What changed

- **New command `saropaWorkspace.showRunAnalytics` ("View Run Analytics").**
  Renders a read-only Markdown summary in a virtual document, modeled on the
  existing Simulate Run audit preview (`saropa-analytics` scheme, single keyed
  document so re-running refreshes rather than stacking tabs).
  - `extension/src/commands/runAnalytics.ts` — new module: provider registration
    (`registerRunAnalytics`), the command entry (`showRunAnalytics`), and the
    report builder. Sections: Totals (pins run, total runs), Most-run pins
    (ranked, bounded to 10), This session's results (success/failure from the
    per-session status registry), Recent runs (timestamps + manual/scheduled
    tag). Disabled-collection and no-data states render an explanatory note
    instead of empty headings.

- **Two read-only accessors added to back the summary** (single source of truth —
  the summary computes nothing the stores do not already own):
  - `Telemetry.counts()` in `extension/src/exec/telemetry.ts` — returns a copy of
    the lifetime per-pin run counts.
  - `RunStatusRegistry.entries()` in `extension/src/exec/runStatus.ts` — returns a
    copied snapshot of the session's recorded results.

- **Wiring and surfaces.**
  - `extension/src/extension.ts` — registers the preview provider in `activate()`.
  - `extension/src/commands/pinCommands.ts` — registers the command handler next
    to Reset Run History.
  - `extension/package.json` — command contribution (`$(graph)` icon), Pins view
    title-menu entry, and Recent-group context-menu entry (alongside Reset Run
    History).
  - `extension/package.nls.json` — `command.showRunAnalytics.title`.
  - `extension/src/i18n/locales/en.json` — `analytics.*` runtime strings. Relative
    "time ago" wording reuses the existing `projectFiles.*` keys rather than
    duplicating them.

### Acceptance criteria (roadmap 3.3)

- Reads only the on-device telemetry store (`globalState`) plus the in-memory
  per-session status registry; transmits nothing. Satisfied — every read is from
  on-machine state; no network call exists in the module.
- Respects Reset Run History: the report reads the stores live, so a reset empties
  it on the next open.
- Respects the disable setting: `telemetry.enabled()` gates the report; when off,
  the summary states collection is off and shows nothing.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean.
- `node esbuild.js` from `extension/` — bundle builds.
- No automated test added: the extension has no test harness yet (unit tests are
  the unshipped roadmap Phase 4.1 item; there is no `src/test/` and no test
  runner). Verified by type-check, bundle build, and inspection.

### Notes for maintainers

- The success/failure split is sourced from `RunStatusRegistry`, which tracks only
  the LAST result per pin and only for BACKGROUND runs, in memory, per session
  (integrated-terminal runs have no observable exit code at the extension's
  minimum VS Code version). The summary therefore labels that section as
  session-scoped; it is not a lifetime success/failure tally, because no such
  durable record is collected.

# Saropa screen-title prefix

Full-screen webview surfaces did not consistently carry the product name: the
dashboard panel read "Saropa Dashboard" but the planner panel read
"Schedule & Workflow Planner" with no prefix. Every full-screen surface should be
branded consistently, so the planner title was prefixed and the convention was
written down as a standing rule.

## Finish Report (2026-06-26)

### What changed

- **`extension/src/i18n/locales/en.json`** — the `planner.title` catalog value
  changed from "Schedule & Workflow Planner" to
  "Saropa Schedule & Workflow Planner". This one key feeds three surfaces in
  `extension/src/views/plannerPanel.ts`: the `createWebviewPanel` tab title, the
  HTML `<title>`, and the in-panel `<h1>`. Changing the value updates all three
  with no duplication.
- **`CHANGELOG.md`** — a "Changed" entry under `[1.5.0] - unreleased` records the
  planner screen now reading "Saropa Schedule & Workflow Planner", matching the
  Saropa Dashboard.
- **`plans/guides/STYLEGUIDE.md`** — new UI style guide capturing the rules every
  user-facing surface follows. The branding section states the rule this change
  applies: full-screen webview panels carry a "Saropa " title prefix; the menu
  items, buttons, and commands that open them do not (the command palette already
  prefixes commands with the "Saropa Workspace" category, and context-menu actions
  live under the Saropa Workspace view). It also documents i18n externalization,
  native-first surfaces, the no-silent-async feedback bar, voice, American English,
  and the design-token bar — grounded in the existing surfaces.

### Scope boundary

The command that opens the planner (`command.openPlanner.title`,
"Open Schedule & Workflow Planner") was intentionally left unchanged. The branding
prefix applies to the screen, not the action that opens it.

### Verification

- `en.json` parses as valid JSON; `planner.title` resolves to
  "Saropa Schedule & Workflow Planner".
- No test asserts the planner title string, so no test expectation needed
  updating (the planner test file checks the webview stylesheet, not the title).

# Rename schedule editor screen title

The per-schedule editor webview was titled "Saropa Schedule: {name}", which abbreviated the
product name and read ambiguously next to the separate "Saropa Schedule & Workflow Planner"
panel. The title was renamed to "Saropa Workspace Scheduler: {name}" so the editor's tab,
HTML `<title>`, and `<h1>` heading name the product in full.

## Finish Report (2026-06-28)

### Change

- `extension/src/i18n/locales/en.json` — `scheduleEditor.title` value changed from
  `"Saropa Schedule: {name}"` to `"Saropa Workspace Scheduler: {name}"`. The `{name}`
  interpolation token is unchanged.
- `plans/guides/STYLEGUIDE.md` — the current-screens reference table and the per-item
  title example updated to the new value.
- `CHANGELOG.md` — `[Unreleased] → Changed` entry added describing the rename.

### Scope

Single i18n catalog value plus documentation. No TypeScript logic changed. The key feeds
three call sites, all of which reference it by key with the `{name}` argument:
`scheduleEditorPanel.ts` (the `createWebviewPanel` title and `panel.title` reassignment)
and `scheduleEditorShell.ts` (the HTML title/heading). Because only the catalog value moved
and the placeholder set is identical, no call site or signature required a change.

### Other "Saropa Schedule" surfaces left intact

The planner panel (`planner.title`, "Saropa Schedule & Workflow Planner") is a distinct
screen and was deliberately not renamed.

### Verification

- Grep of `extension/src/test/**` for `scheduleEditor` / `Saropa Schedule` returned no
  matches — no test assertion pins the old title.
- Grep of all call sites confirmed key-based references with a matching `{name}` argument;
  the JSON edit is a value-only swap, so the type surface is unaffected.

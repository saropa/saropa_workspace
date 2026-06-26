# Additional import formats

Roadmap: Later / Exploratory. Overflow from 1.1 — the source formats that need a
written per-format mapping assessment before they commit, plus the ones that did not
make the 1.1 cut.

## Verified current state

Imported today (`favoritesImport.ts`): kdcro101 `.favorites.json`, oleg-shilo
`path|alias` text lists, howardzuo `favorites.resources`. **Not** imported: sabitovvt
`favoritesPanel.json`, Project Manager `projects.json`, Bookmarks `bookmarks.json`.

The pin model supports file pins, line pins, and groups — that bounds what maps without
loss.

## Per-format mapping assessment

Each format ships only if it maps to the pin model without data loss; otherwise it stays
here with the reason recorded.

1. **sabitovvt Favorites Panel** (`favoritesPanel.json` / settings
   `favoritesPanel.commands(ForWorkspace)`). Stores files, URLs, commands, and scripts
   with per-item config — the closest match to this extension's own model. **Maps well:**
   file → file pin, URL → url pin, command → command pin, script → shell pin. This is the
   strongest candidate; assess the per-item config fields for a clean carry-over, then
   ship.
2. **Project Manager** (`projects.json`, global). Entries are *workspace/folder roots*,
   not files. A project root maps to a **file pin on the folder** (open-in-explorer) at
   best — there is no "open project" pin kind. **Partial map:** ships only as folder pins
   if that is judged useful; otherwise defer with the reason "project-switch semantics
   have no pin equivalent."
3. **Bookmarks** (`.vscode/bookmarks.json` when `bookmarks.saveBookmarksInProject`).
   Line-level marks. **Maps to line pins** (which exist). Assess whether label/note
   fields survive; if lossless, ship as line-pin import; if the bookmark carries
   per-line metadata the line pin cannot hold, defer with the reason.

## Remaining work

- Write the assessment above into a committed note as each format is evaluated (this
  file is the home).
- Implement the formats that pass the lossless test, reusing the normalized-entry
  parser pattern from `1.1-extend-favorites-import.md` (parse → `{path,label?,groupName?,
  kind?}[]` → pins) so each new format is a parser plus a mapping, not a new code path.
- Cover each shipped format with mapping + idempotency tests (Phase 4.1).

## Acceptance criteria

- Each format is recorded here as shipped (with its mapping) or deferred (with the
  data-loss reason).
- Shipped formats import idempotently and report malformed entries without aborting.

## Dependencies

- Shares the parser refactor and the Project Manager / Bookmarks decision with
  `1.1-extend-favorites-import.md`.
- Tests depend on Phase 4.1.

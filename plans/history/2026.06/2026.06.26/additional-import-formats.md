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
here with the reason recorded. Schemas were verified against each extension's source
(not assumed): the on-disk JSON shapes and field semantics below come from the upstream
repositories.

1. **sabitovvt Favorites Panel** — **SHIPPED.** Source: settings keys
   `favoritesPanel.commands` (global) and `favoritesPanel.commandsForWorkspace` (per
   workspace), each an array of command-dispatch items
   `{ label, icon?, iconColor?, command, arguments[] }` or `{ label, sequence: [...] }`.
   It is a command-dispatch model, *not* the clean file/url/command/script kinds the
   earlier note assumed; the real `command` value selects the action. Mapping:
   - `command: "openFile"` → **file pin** on `arguments[0]` (resolved against the folder).
   - `command: "run"` → **shell pin** running `arguments[0]` (a program/terminal line).
   - `command: "runCommand"`, `arguments[0] === "vscode.open"` → **url pin** on
     `arguments[1]`.
   - `command: "runCommand"`, otherwise → **command pin** (`commandId = arguments[0]`,
     `commandArgs = arguments.slice(1)`).
   - `sequence: [...]` → **macro pin**, one step per command, but only when *every* step
     maps; one unmappable step skips the whole sequence rather than silently dropping it.
   - `command: "insertNewCode"`, unknown commands, and unmappable sequences → reported
     and skipped (the pin model has no insert-code action). The item's `icon` (a codicon
     id) and `iconColor` (a ThemeColor id) line up with the pin model's icon/color and
     are carried over for action pins. The custom-file variant is also covered: items
     stored in the JSON file the `favoritesPanel.configPath` / `configPathForWorkspace`
     settings point at are read with the same mapping, accepting both the v1.4.0+
     top-level array and the legacy `{ "favoritesPanel.commands": [...] }` object
     wrapper. A missing file imports nothing; a malformed file is reported and skipped.
2. **Project Manager** (`projects.json`, global) — **DEFERRED.** Verified shape: an array
   of `{ name, rootPath, paths?, tags?, enabled?, profile? }`. Every entry's `rootPath`
   is a *folder/workspace root*, not a file or a runnable target, and the pin model has
   no open-folder / open-workspace pin kind. A folder reveal would be the only possible
   map and it discards the entry's purpose (switch to that project). **Reason:**
   project-switch semantics have no lossless pin equivalent.
3. **Bookmarks** (`.vscode/bookmarks.json`, written when
   `bookmarks.saveBookmarksInProject` is on) — **SHIPPED as line pins.** Verified shape:
   `{ files: [ { path, bookmarks: [ { line, column, label? } ] } ] }`. The stored `line`
   is **0-based** (the raw `vscode.Position.line`), so it imports as `line + 1` into the
   pin model's 1-based `line`. `path` is folder-relative (forward-slashed; older files
   prefix a `$ROOTPATH$/` token that is stripped) or absolute. The bookmark `label`
   becomes the pin label, falling back to the `basename:line` default. `column` is dropped
   — a line pin has no column and a jump target does not need one — which is the only
   loss, and it is immaterial. Re-import is idempotent (dedup by resolved file + line).

## Remaining work

All complete.

- **Custom-file variant of sabitovvt** (`favoritesPanel.configPath` /
  `configPathForWorkspace`) — **DONE.** `readSabitovvtConfigFileItems` in
  `favoritesSettings.ts` reads the pointed-at JSON file (absolute path as-is, relative
  resolved against the first folder), accepts the top-level array and the legacy object
  wrapper, and feeds the items through the same `importSabitovvtItemList` mapping as the
  two settings keys, with one shared dedup set across all sources.
  `detectSabitovvtFavoritesCount` is now async so the import gate counts file items too.
- **Mapping + idempotency tests** — **DONE.** `test/bookmarksImport.test.ts` (0-based→
  1-based line conversion, `$ROOTPATH$` strip, label fallback, column-dropped, outside-
  folder skip, malformed guard, dedup on re-run) and `test/sabitovvtImport.test.ts`
  (openFile/run/runCommand url+command mapping, sequence→macro all-or-nothing,
  insertNewCode/unknown/unlabeled skip, icon/color carry-over, action-pin dedup, the
  configPath array + legacy-wrapper shapes) — 12 tests, all passing under `node --test`.

## Acceptance criteria

- Each format is recorded here as shipped (with its mapping) or deferred (with the
  data-loss reason). **Done:** sabitovvt + Bookmarks shipped; Project Manager deferred.
- Shipped formats import idempotently and report malformed entries without aborting.
  **Done:** dedup by resolved file+line (bookmarks) and by action signature (sabitovvt);
  every unmappable/malformed entry is logged to the output channel and skipped.

## Dependencies

- Shares the parser refactor and the Project Manager / Bookmarks decision with
  `1.1-extend-favorites-import.md`.
- Tests depend on Phase 4.1 (the `node --test` harness), now landed.

## Finish Report (2026-06-26)

Closed the two open items, completing the plan.

- **sabitovvt custom-file import** (`extension/src/import/favoritesSettings.ts`):
  extracted the per-item loop into `importSabitovvtItemList` (shared by the settings
  keys and the file), added `readSabitovvtConfigFileItems` (reads
  `favoritesPanel.configPath` + `configPathForWorkspace`; accepts the top-level array
  and the legacy `{ "favoritesPanel.commands": [...] }` wrapper; missing file → nothing,
  malformed → logged + skipped), and made `detectSabitovvtFavoritesCount` async so the
  import gate counts file items. Updated the one caller
  (`commands/pinManagementCommands.ts`) to await it.
- **Tests**: `extension/src/test/bookmarksImport.test.ts` (5) and
  `extension/src/test/sabitovvtImport.test.ts` (7) — 12 tests, all passing.
- **Verification**: `npx tsc -p ./ --noEmit` clean; the two test files pass under
  `node --test`. No other workstream touched.

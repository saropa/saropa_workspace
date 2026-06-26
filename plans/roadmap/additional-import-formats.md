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
     are carried over for action pins. **Not yet covered:** items stored in a custom file
     via `favoritesPanel.configPath(ForWorkspace)` (only the two settings keys are read).
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

- **Custom-file variant of sabitovvt** (`favoritesPanel.configPath` /
  `configPathForWorkspace`): read items from the pointed-at JSON file as well as the two
  settings keys.
- Cover each shipped format with mapping + idempotency tests once the Phase 4.1 harness
  lands (`4.1-unit-tests.md`): bookmarks 0-based→1-based line conversion, `$ROOTPATH$`
  strip, column-dropped, dedup on re-run; sabitovvt openFile/run/runCommand(url+command)
  mapping, sequence→macro all-or-nothing, insertNewCode/unknown skip, action-pin dedup,
  icon/color carry-over.

## Acceptance criteria

- Each format is recorded here as shipped (with its mapping) or deferred (with the
  data-loss reason). **Done:** sabitovvt + Bookmarks shipped; Project Manager deferred.
- Shipped formats import idempotently and report malformed entries without aborting.
  **Done:** dedup by resolved file+line (bookmarks) and by action signature (sabitovvt);
  every unmappable/malformed entry is logged to the output channel and skipped.

## Dependencies

- Shares the parser refactor and the Project Manager / Bookmarks decision with
  `1.1-extend-favorites-import.md`.
- Tests depend on Phase 4.1.

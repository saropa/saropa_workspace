# Duplicate with Argument

A file shortcut could only be run with the single argument line stored on it; keeping a
plain run and a "run with `-o`" variant side by side required manually adding the same
file twice and editing each one's arguments. This change adds a "Duplicate with Argument"
right-click action that copies a file shortcut into a new run variant with its own
argument line and name in two prompts.

## Finish Report (2026-07-06)

### Scope

VS Code extension (TypeScript, `extension/`). No Flutter/Dart. Flutter l10n validation is
not applicable; extension i18n was added at write time (English catalog + manifest NLS).

### Change

A new command `saropaWorkspace.duplicateWithArgs` is added to the file-shortcut context
menu, in the configure/run submenu directly after "Configure Run (Quick)". The menu entry
is gated to stored file shortcuts (`viewItem =~ /^shortcut(Scheduled)?(Paused)?$/`), so
auto and recipe shortcuts — which are recomputed rather than stored — never reach it, and
the command additionally guards on `shortcutKind === "file"` so a stored url/shell/command
shortcut (which carries no argument line) is rejected with a naming warning.

The handler (`commands/duplicateWithArgs.ts`) runs two input prompts:

1. **Arguments** — pre-filled with the source's current arguments (`formatArgs`), so the
   user edits an existing line rather than retyping it. Parsed back with `parseArgs`, the
   same quoted-span-aware pair the run-config editor and the run-with-overrides palette
   use.
2. **Name** — defaults to the base name with the entered arguments suffixed
   (`setup_arb_translate.py -o`), editable. `baseNameFor` strips a suffix that merely
   echoes the source's own current arguments before appending, so duplicating a duplicate
   does not compound the suffix.

The store method `duplicateShortcut(shortcut, label, args)`
(`model/shortcutStoreMutationCore.ts`) creates the new entry pointing at the same file,
merging the new arguments over the source's exec so the interpreter, working directory,
environment, and run location survive while only the arguments change (an empty argument
line clears the field, and an all-empty exec collapses to `undefined` for round-trip
parity). It carries `masked` and `line` deliberately — both are behavior, not decoration:
`masked` (the screen-share guard) must survive or a duplicate of a protected secret would
expose the file name in the tree, and `line` preserves a line-shortcut's open-at-line
target. It deliberately does NOT inherit `schedule`, `triggers`, `metric`, `expiry`,
`tags`, or `branch`: the first four are per-instance automation (copying a schedule would
silently double-schedule the same script), and a fresh variant starts un-tagged and
branch-unscoped. The new entry is inserted immediately below the source in the same scope
and group via the existing `placeAfter` helper. It returns `false` only when the source is
no longer in its store (a race where it was removed mid-flow); the command surfaces that as
a visible warning rather than returning silently.

### Review outcome

A read-only review flagged three items, all addressed:

- **`masked` was not carried** — a privacy regression for a duplicated screen-share-guarded
  shortcut. Fixed by carrying `masked` (and `line`) in the store method.
- **Silent no-op on the `false` return** — violated the no-silent-async rule. Fixed with a
  `duplicateArg.failed` warning naming the shortcut.
- **No unit test for `duplicateShortcut`** — added five tests (below). The name-suffix
  compounding edge case (a prior label built with non-canonical spacing) is documented as
  best-effort and left as-is.

### Tests

Added to `test/shortcutStoreMutationCore.test.ts` and run under `node --test` (19 pass, 0
fail):

- inserts a variant after the source with merged exec and new args (order, path, exec).
- does not inherit the source's schedule (no double-scheduling).
- carries the `masked` flag so a secret's duplicate stays hidden.
- clears exec when the source has none and the argument line is empty.
- returns `false` for a source not in its store.

`parseArgs`/`formatArgs`, which the command depends on, are already covered by
`configureRunCommand.test.ts`.

### Files

- `extension/src/model/shortcutStoreMutationCore.ts` — `duplicateShortcut` method.
- `extension/src/commands/duplicateWithArgs.ts` — command handler (new).
- `extension/src/commands/shortcutConfigCommands.ts` — registration.
- `extension/package.json` — command declaration, configure-submenu entry, palette-hide.
- `extension/package.nls.json` — command title.
- `extension/src/i18n/locales/en.json` — prompt/placeholder/message keys.
- `extension/src/test/shortcutStoreMutationCore.test.ts` — five new tests.
- `CHANGELOG.md` — Unreleased "Added" entry.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- Scoped `node --test` on the mutation-core test bundle — 19/19 pass.

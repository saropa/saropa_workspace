# Import external favorites comments and separators as annotation pins

Roadmap: Later / Exploratory. Carried forward from
`plans/history/2026.06/2026.06.25/comments-and-separators.md` (the core
comment/separator feature shipped 2026-06-25; this is its one open item).

## Verified current state

The comment / separator annotation entry kinds exist and work end to end (model
`isAnnotationPin`, store `addAnnotationPin`, tree rendering, run/click guards,
authoring commands, pin-set export/import). What remains is importing equivalents
from the EXTERNAL favorites formats the importer reads.

`extension/src/import/favoritesImport.ts` parses kdcro101 / oleg-shilo favorites
files. Its line parser explicitly treats `#` comment lines and blank lines as
"structural, not skipped entries" (see the comment near `favoritesImport.ts:210`)
— meaning they are currently **dropped**. The oleg-shilo Favorites Manager uses
those `#` lines as visible comments and blank lines / dividers as separators.

## Remaining work

1. **Parse external annotations.** In `favoritesImport.ts`, stop discarding `#`
   comment lines and blank/divider lines: turn a `#`-prefixed line into a comment
   annotation (its text = the line minus the leading `#`), and a blank/divider line
   into a separator annotation, preserving their position in the file so the
   imported list keeps the source's sectioning.
2. **Create the pins.** Route each parsed annotation through `store.addAnnotationPin`
   (or the import batch path) so they land in order among the imported file pins.
   Importing must stay idempotent for real pins but must NOT dedupe annotations
   (they are positional) — mirror the `isDuplicate` carve-out already in
   `pinSetExport.ts`.
3. **Scope check.** Confirm the other supported source formats (settings
   `favorites.resources`, sabitovvt Favorites Panel) carry no comment/divider
   concept; if one does, map it the same way, else leave it untouched.

## Acceptance criteria

- Importing a kdcro101 favorites file that contains `#` comments and blank-line
  dividers produces comment / separator annotation pins in the same order as the
  source, alongside the file/url/shell/command/macro pins it already imports.
- Re-running the import does not pile up duplicate annotations beyond what the
  source file actually contains on each run (match the existing import idempotency
  story; positional annotations are added per source entry).
- No regression to the existing import: a favorites file with no comments/dividers
  imports exactly as before.

## Dependencies

- Builds on the shipped annotation entry kinds (`isAnnotationPin`,
  `store.addAnnotationPin`). No blocking dependency.

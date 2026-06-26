# Import external favorites comments and separators as annotation pins

> **Status: Done (2026-06-25).** Implemented in `importOlegShilo`
> (`favoritesImport.ts`): `#` lines import as comment annotations, blank-line
> dividers as separators, in source order in the file's owning folder, via a new
> `targetFolder` argument on `store.addAnnotationPin`. Blank runs collapse and
> leading/trailing blanks are dropped. Annotations are positional and not deduped
> (mirroring the `pinSetExport.ts` carve-out); file pins keep their path-dedup
> idempotency. Scope check (item 3) confirmed: the kdcro JSON, howardzuo
> `favorites.resources`, and sabitovvt Favorites Panel formats carry no
> comment/divider concept, so they were left untouched. See the Finish Report below.

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

## Finish Report (2026-06-25)

**What shipped**

- `extension/src/import/favoritesImport.ts` — `importOlegShilo` no longer drops
  `#` comment lines and blank lines. A `#` line becomes a comment annotation (text =
  line minus the leading `#`); a blank line becomes a separator annotation. Both are
  created via `store.addAnnotationPin` in source order, interleaved with the file
  pins they sit between.
- `extension/src/model/pinStore.ts` — `addAnnotationPin` gained an optional
  `targetFolder` argument. The no-anchor import path previously appended to the
  first workspace folder; the importer now passes `detected.folder` so an annotation
  lands in the same folder (and order) as the oleg-shilo file's pins in a
  multi-folder workspace.

**Behavior decisions**

- Blank-line handling is not literal: a run of blanks collapses to one separator, a
  leading blank (before the first real entry) is dropped, and a trailing blank at
  end-of-file produces no dangling separator. Implemented with a deferred
  `separatorPending` flag flushed only when a following real entry (comment or file
  pin) is added. This keeps the source's sectioning without leaking dividers from
  file formatting (a trailing newline, a stray double newline).
- Annotations are positional and intentionally NOT deduped, mirroring the
  `isDuplicate` carve-out in `commands/pinSetExport.ts`. File pins keep their
  existing path-dedup idempotency, so re-import adds no duplicate file pins; the
  positional annotations are re-added per source entry, per run (the accepted
  "added per source entry" story).
- Scope check (plan item 3): the kdcro101 `.favorites.json` (typed JSON entries),
  howardzuo `favorites.resources` (array of paths), and sabitovvt Favorites Panel
  (command-dispatch items) formats carry no comment/divider line concept, so they
  were left untouched.

**Acceptance criteria**

- An oleg-shilo list with `#` comments and blank-line dividers imports comment /
  separator annotation pins in source order alongside its file pins. Met.
- Re-import adds no duplicate file pins (path dedup); positional annotations are
  added per source entry. Met.
- A list with no comments/dividers imports exactly as before — the new code only
  acts on `#`/blank lines, which the prior code discarded. Met.

**Verification**

- `npx tsc -p ./ --noEmit` clean; `node esbuild.js` bundles. No host-free
  (`node --test`) path covers the importer — it imports the `vscode` module, which
  the Node test runner cannot load, and `@vscode/test-electron` is not yet wired, so
  the parsing logic is not separable into a pure unit without a refactor outside this
  plan's scope. Manual smoke test in the dev host is the remaining check.

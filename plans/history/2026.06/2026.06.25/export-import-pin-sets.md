# Export / import pin sets (roadmap 2.1)

Project pins committed in `.vscode/saropa-workspace.json` served as the only
team-shared baseline, and the single-pin share link carried one pin at a time
through a URL. This adds explicit export/import of a whole pin set — pins and their
groups — through a versioned, self-describing file.

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript). No Dart/Flutter code touched.

### What changed

- **New module `extension/src/commands/pinSetExport.ts`** with two commands:
  - `exportPinSet(store)` ("Export Pins to File") — pick scope (all / project /
    global), gather each chosen scope's user pins (recipe and auto pins excluded —
    they re-detect on the importing machine) and groups, write a versioned JSON via
    a Save dialog. File shape: `{ format: "saropa-workspace-pins", version: 1,
    project?, global? }`, each scope `{ groups: ExportedGroup[], pins:
    ExportedPin[] }`. A pin carries the portable `SharedPin` subset plus a
    `groupKey` join key.
  - `importPinSet(store)` ("Import Pins from File") — read and validate the file
    (format + version checked; never throws), pick scope, recreate groups, and add
    each non-duplicate pin into its mapped group. Reports added vs skipped.

- **Idempotency / no-clobber:** import is additive. A pin already present in the
  target scope is skipped — file pins match by path (the same resolved-path rule
  the favorites import uses), action pins by label + action kind. Groups reuse an
  existing same-label group rather than creating a duplicate folder, so a repeat
  import converges instead of piling up.

- **`extension/src/model/pinStore.ts`** — `importPin` gains an optional `groupId`
  (backward-compatible) so an imported pin lands in its recreated group in one
  call, with no follow-up move. Extends the existing method rather than adding a
  parallel path.

- **Wiring / strings:** `pinCommands.ts` registers `exportPins` / `importPins`;
  `package.json` adds the two commands ($(export) / $(cloud-download)) and a
  `2_share` group in the Pins view title menu; `package.nls.json` the two titles;
  `en.json` the `pinSet.*`, `export.*`, and `import.set.*` strings.

- **Roadmap trimmed of completed items:** removed Phase 2 (its only item, 2.1,
  shipped here), 3.1 Workspace boot sequence, and 3.3 Local run-analytics summary
  (both shipped earlier the same day). Fixed the now-dangling 3.3 reference in the
  3.4 Dashboard "Depends on" line.

### Acceptance criteria (roadmap 2.1)

- Versioned, self-describing file; import idempotent and reuses the share-link
  portable shape. Satisfied.
- Imported sets respect scope and never silently overwrite — additive only;
  conflicts are surfaced as a skipped count, not clobbered. Satisfied.
- Round-trip reproduces the set including groups, run config, and icons —
  `SharedPin` carries action/exec/icon/color/schedule; groups are recreated and
  re-mapped. Satisfied.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean.
- `node esbuild.js` from `extension/` — bundle builds.
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by type-check, bundle build, and inspection.

### Notes for maintainers

- "Selected groups" export (vs whole scope) is not implemented; export is
  scope-level (all / project / global). A future refinement could add a
  group-level multi-select.
- Global pins store absolute paths, so a global-scope round-trip only reproduces
  on a machine where those paths exist; project pins are folder-relative and
  portable.

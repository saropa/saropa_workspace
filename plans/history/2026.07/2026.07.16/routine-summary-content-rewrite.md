# Routine summary rewrite — content instead of execution mechanics

The routine summary document (the one window a routine opens after running its
members) rendered a Markdown table of execution mechanics — per-member status,
duration, report link, notes — and a verdict line that said "all clear" even when a
member was missing or merely dispatched. Users open the summary to read the day's
results (the standup digest, project stats, PR queue), not to audit the runner, so
the document carried no value and misreported the run.

## Finish Report (2026-07-16)

### What changed

- `extension/src/exec/routineRunner.ts` — `writeRoutineSummary` no longer writes an
  outcome table. It merges each member report's full Markdown body into the summary
  as a `## <member>` section (via the new exported `embedMemberReport`), with a
  relative source link under each heading. Execution state surfaces only when
  something went wrong: failed or missing members produce one blockquote attention
  line at the top naming the member, what happened, and what to do. A clean run
  reads as pure content; a routine whose members produce no reports gets a single
  self-explaining line.
- `embedMemberReport` drops each report's leading H1 (the section heading already
  names it), demotes remaining ATX headings two levels (clamped at H6), and leaves
  fenced code blocks untouched. Fence tracking pairs the opening fence's character
  and length per CommonMark — `buildCommandReport` deliberately widens its fence to
  (longest inner run + 1) so captured output containing ``` stays inside, and a
  naive any-run toggle would flip state on that inner run and mangle the document.
- Tracked member failures now carry an exit-code detail
  (`routine.note.failedExit`) so the attention line is never a bare "Failed —
  <member>".
- `extension/src/i18n/locales/en.json` — replaced the table-era keys
  (`routine.summary.line/allOk/failures/unconfirmed/col*`, `routine.note.dispatched`)
  with `routine.summary.readFailed/noReports` and `routine.note.failedExit`;
  status labels retained for attention lines.
- `extension/src/test/routineRunner.test.ts` — the table-format assertion was
  replaced with assertions on the merged shape (section heading, H1 dropped,
  inner headings demoted, no table, relative source link), plus a direct unit test
  for `embedMemberReport` covering the widened-fence case and the H6 clamp.
  11/11 tests pass (scoped bundle via esbuild + `node --test`).
- `plans/guides/STYLEGUIDE.md` — the generated-reports section now codifies: the
  summary IS the content; execution state appears only on failure and explains
  itself; "all clear" wording requires every member confirmed ok.
- Root `CHANGELOG.md` — `[Unreleased]` Changed entry.

### Verification

- `npx tsc -p ./ --noEmit` clean; `node esbuild.js` bundle clean.
- Scoped test run: `npx esbuild src/test/routineRunner.test.ts --bundle …` +
  `node --test out/test/routineRunner.test.cjs` — 11 pass, 0 fail.

### Known limits

- Setext headings (`Title` over `===`) are not recognized by the embedder — no
  report writer emits them; the assumption is documented at the function.
- No size cap on the merged document; several verbose members produce one long
  file by design (the content is the point). Revisit only if a real routine
  produces an unreadable document.

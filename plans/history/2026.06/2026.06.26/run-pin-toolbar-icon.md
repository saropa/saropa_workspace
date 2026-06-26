# Run Pin toolbar icon

The Pins view title-bar action **Run Pin...** (`saropaWorkspace.runAnyPin`), which
opens a picker to run a single chosen pin, was declared with the `$(run-all)`
double-arrow codicon. That glyph is VS Code's conventional "run all" symbol, so the
toolbar button read as a command to run every pin at once rather than to run one pin.

The icon was changed to `$(play)` (single play triangle), matching the per-row inline
run button (`saropaWorkspace.runPin`, also `$(play)`), so the title-bar action's glyph
now matches its single-pin behavior.

## Finish Report (2026-06-26)

### Defect
`extension/package.json` declared the `runAnyPin` command with `"icon": "$(run-all)"`.
`runAnyPin` runs one pin selected from a QuickPick (title key
`command.runAnyPin.title` = "Run Pin..."). The `run-all` double-arrow glyph signals
"run everything", misrepresenting a single-pin picker as a batch action. It is shown in
the Pins view title bar via the `view/title` `navigation@2` contribution.

### Change
- `extension/package.json` — `runAnyPin` command icon changed from `$(run-all)` to
  `$(play)`, aligning with the per-pin inline run button and the single-pin behavior.

### Scope and non-changes
- `kindIcon("routine")` in `extension/src/views/pinRowTokens.ts` still returns
  `run-all` and its assertion in `extension/src/test/pinRowTokens.test.ts` is unchanged:
  a routine legitimately runs a block of recipes back-to-back, so the double-arrow is
  correct there.
- Other `$(run-all)` uses (`runPinLastParams`, `runBootSequence`,
  `newRoutineFromSelection`, recipe/pinExecution routine icons) are batch- or
  sequence-oriented and were left as-is.
- No TypeScript, no l10n strings, no dependencies touched. The command title is
  unchanged.

### Verification
- `package.json` re-parsed as valid JSON after the edit.
- No test covers a manifest icon declaration; the only `run-all` test asserts the
  routine glyph, which is intentionally unchanged.

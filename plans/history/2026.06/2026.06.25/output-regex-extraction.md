# Extract a value from a background run's output

A background run can print hundreds of log lines when the only thing that matters is
one — a deploy URL, a generated id. This adds a per-pin extraction regex that, when
the run finishes, copies the matched value to the clipboard with a toast.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`PinExecConfig.extractResult?: string`** (model/pin.ts): an optional regex matched
  against a background run's combined output on completion. The first capture group
  (or the whole match when there is no group) is copied to the clipboard.
- **`exec/runner.ts`**: `RunPlan` carries `extractResult`; `planRun` reads it from the
  pin's exec config; `runInBackground` takes it as a parameter and, in the single
  `settle` path, calls `extractAndCopy(pattern, capturedOutput, name)`. The helper
  compiles the pattern with the `m` flag (so `^`/`$` anchor to lines — the intuitive
  choice for grabbing one line), copies the result with a toast, and logs an invalid
  pattern or a no-match to the output channel without failing the run. Extraction runs
  on any completion (a URL printed before a non-zero exit is still captured). It reuses
  the output buffer already accumulated for "Diff Last Two Runs".
- **`commands/configureRun.ts`**: a new **Extract from output** field in the run-config
  hub — seeded, normalized (empty collapses to undefined for JSON parity), and edited
  via an input box that validates the entry is a real regex inline so a typo never
  persists.

### Why background-only
Only the background output channel captures a run's output; the integrated terminal
and external-window locations do not. The model doc and the configure prompt both say
the field applies to background runs, and `planRun` passes it only down the background
branch.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; manifests parse-validated. No
test harness in the extension; verified by type-check, build, and inspection.

### Localization
`configure.field.extract` / `configure.extract.*` and `extract.*` strings added to
`en.json`. No new manifest title (the field lives inside Configure Run). No MT pipeline
in this repo.

### Not implemented (deliberate)
The pitch also suggested a live pin description badge showing the extracted value. The
clipboard+toast path is the variant the pitch itself called "better", and a live
tree-badge would require threading per-pin extracted state into the tree render path;
it was left out to keep this change contained. If wanted, it is a separate follow-up.

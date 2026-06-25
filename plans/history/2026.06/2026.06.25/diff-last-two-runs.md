# Diff a pin's last two background runs

After re-running a failing background task, telling whether the error is the same one
or a new one meant scrolling a wall of log output. This caches the last two
background-run outputs per pin and opens VS Code's native side-by-side diff of
previous vs latest.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **New `exec/runOutputs.ts` singleton.** Keeps up to two `CapturedRun` records
  (combined output, end time, exit code) per pin id, memory-only and bounded to two
  (oldest evicted). `lastTwo` returns `[older, newer]` or undefined when fewer than
  two runs exist.
- **`exec/runner.ts` `runInBackground` hook.** Accumulates the combined stdout+stderr
  into a buffer alongside the existing live channel streaming, and on settle records
  it via `runOutputs.record` with the run's end time and exit code. The single
  `settle` guard means a run that emits both `error` and `close` is recorded once.
- **New `commands/diffRuns.ts`.** `diffLastRuns(pin)` reads the last two captured
  runs and opens them with the built-in `vscode.diff`. Each side is a read-only
  virtual document (scheme `saropa-runoutput`) carrying a one-line header (end time +
  exit code) above the raw output, so the two sides are self-identifying. When fewer
  than two runs exist it shows a message and does nothing. The content provider is
  registered via `registerRunOutputDiff` and disposed on deactivation.
- **New command `saropaWorkspace.diffLastRuns`** ("Diff Last Two Runs") on every pin's
  context menu (`1_actions`), palette-gated off (needs a pin arg). Unpin clears the
  pin's captured outputs.

### Why it is correct / safe
Capture is additive to the existing streaming (same text, appended to a buffer), so
live output is unchanged. The feature is read-only with respect to the workspace —
only run output already produced is shown. Memory-only storage is deliberate: run
logs are not worth persisting across reloads, and bounding to two entries caps memory.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; manifests parse-validated. No
test harness in the extension; verified by type-check, build, and inspection.

### Localization
`diffRuns.*` runtime strings added to `en.json`; `command.diffLastRuns.title` to
`package.nls.json`. No MT pipeline in this repo.

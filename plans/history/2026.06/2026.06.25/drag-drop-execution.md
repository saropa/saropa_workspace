# Drag-and-drop execution onto a script pin

Running a pinned script against a specific file meant opening a terminal and typing
the path. This makes a runnable pin a drop target: drag a file from the Explorer onto
it and the script runs against that file, with the path exposed as a `$droppedFile`
token.

## Finish Report (2026-06-25)

### Scope
VS Code extension (TypeScript). No Flutter/Dart code.

### What changed
- **`exec/tokens.ts` / `exec/runner.ts`**: `planRun` and `runPin` gained an optional
  `extraTokens` map, merged over the standard file tokens, so a run can carry
  run-specific values (here `$droppedFile`). Backward compatible — existing callers
  (scheduler, simulate) pass nothing.
- **`views/pinsTreeProvider.ts`**: `text/uri-list` added to `dropMimeTypes`.
  `handleDrop` now routes a drop with no internal pin payload to
  `handleExternalFileDrop`, which takes the first dropped file URI and invokes
  `saropaWorkspace.runPinOnFile` with the target pin and the file path. Only a pin row
  is a valid target; group/scope headers are ignored. Internal pin reordering is
  unchanged (it carries the `PIN_MIME` payload and is handled first).
- **`commands/pinCommands.ts`**: new `saropaWorkspace.runPinOnFile` command →
  `runPinOnDroppedFile`. It runs a file/runnable pin with `extraTokens =
  { droppedFile }`. If the pin's command/args already reference `$droppedFile`, the
  pin runs as-is; otherwise an ephemeral clone appends `$droppedFile` as a trailing
  argument so a plain script still receives the file. The stored pin is never mutated.
  A non-file or non-runnable pin is a no-op with a naming message; a missing target
  reuses the relocate/unpin flow.

### Why an appended-arg fallback
The pitch is token-based (`$droppedFile`), but a user who has not placed the token
would otherwise see the script run without the file. Appending the path as the final
argument matches the universal "drag a file onto a tool" expectation, while the token
gives precise placement when needed.

### Verification
`npx tsc --noEmit` exit 0; `node esbuild.js` exit 0; en.json parse-validated. No test
harness in the extension; verified by type-check, build, and inspection.

### Localization
`drop.notRunnable` added to `en.json`. The `$droppedFile` token is a code identifier,
not display text. No MT pipeline in this repo.

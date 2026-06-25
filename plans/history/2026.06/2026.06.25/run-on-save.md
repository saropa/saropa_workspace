# Run on save (roadmap Later / Exploratory)

A pin could only be run manually, on a schedule, or by recipe chaining — there was
no way to have a pin run automatically when its target file is saved, the
Code-Runner "run on save" convenience. This adds a per-pin opt-in flag and a
save listener that runs the matching pin.

## Finish Report (2026-06-25)

### Scope

VS Code extension (TypeScript). No Dart/Flutter code touched.

### What changed

- **`extension/src/model/pin.ts`** — `PinExecConfig` gains `runOnSave?: boolean`.
  Placed in the exec config beside the other run-behavior flags (`elevated`,
  `dependsOn`, `sound`, `includeFilePath`), not on `Pin`, so all run toggles stay
  in one inventory. Off (undefined/false) by default.

- **`extension/src/commands/configureRun.ts`** — a **Run on save** field added to
  the Configure Run hub the same way the existing toggles are: id in the `HubItem`
  union, seeded into the working copy, a hub row showing On/Off, an `editRunOnSave`
  two-option picker, and a `normalize` entry collapsing `false`→undefined for
  round-trip JSON parity.

- **`extension/src/extension.ts`** — an `onDidSaveTextDocument` listener (disposed
  via `context.subscriptions`) calls `runPinsOnSave(store, uri)`, which runs every
  runnable file pin whose resolved target equals the saved file and which has
  `exec.runOnSave === true`. It dispatches through the existing
  `saropaWorkspace.runPin` command, so the run reuses token resolution, telemetry,
  and the per-run toast. A non-runnable file pin (and any non-file/action pin) is
  filtered out — it would only "open" the file the user is already editing. The
  same file pinned more than once fires each matching pin.

- **`CHANGELOG.md`** — Unreleased "Added" entry. **`ROADMAP.md`** — the
  Later/Exploratory "Run on save" bullet removed and the competitive-landscape gap
  table row changed from "Gap" to "Shipped".

### Why it is safe

- No save-loop: running a pin does not auto-save its source file, so a run cannot
  recursively re-trigger the save listener. A pin whose own script edits and saves
  its target could re-fire, but that is the user's explicit opt-in script, not a
  framework loop.
- Opt-in and narrow: off by default; only a runnable file pin can carry it, so a
  save never triggers an unexpected run.

### Verification

- `npx tsc -p ./ --noEmit` from `extension/` — clean.
- `node esbuild.js` from `extension/` — bundle builds.
- No automated test added: the extension has no test harness yet (roadmap Phase
  4.1, unshipped). Verified by type-check, bundle build, and inspection.

### Notes for maintainers

- "Auto-save-before-run" (the other half of Code Runner's run-on-save) is not
  implemented; this triggers ON a save the user performs, it does not save for
  them. A future refinement could add an auto-save option.

# Windows `python3` interpreter normalization

On Windows the bare command name `python3` is a Microsoft Store app-execution
alias stub that prints "Python was not found" instead of running, so any shortcut
resolving to `python3` (via its Run command, the file-type default map, or a
`#!/usr/bin/env python3` shebang) never reached a real interpreter and failed.
The interpreter resolver now rewrites a leading bare `python3` to `python` on
win32, so those shortcuts run.

## Finish Report (2026-07-04)

### Defect

`resolveInterpreter` (extension/src/exec/commandPlan.ts) returned the resolved
interpreter prefix verbatim. On win32 a resolved value of `python3` — whether it
came from a pin's explicit `exec.command`, the `saropaWorkspace.interpreterDefaults`
map, or a script's `#!/usr/bin/env python3` shebang — was handed to the shell as
`python3`, which on Windows is only the Store alias stub. The run produced
"Python was not found" and never executed. A sibling pin with no explicit command
(e.g. `publish.py`) worked because it fell back to the `.py` default `python`,
which is a real launcher, isolating the fault to the literal `python3` name.

### Change

- **extension/src/exec/commandPlan.ts** — added `normalizeForPlatform`, applied at
  each non-blank return of `resolveInterpreter` (explicit command, extension
  default, shebang). On win32 it rewrites a leading `python3` token to `python`
  via `/^python3(?=$|\s)/`, preserving trailing args (`python3 -u` -> `python -u`).
  It is a no-op off win32 (where `python3` is canonical) and leaves a versioned
  name (`python3.12`) or an absolute interpreter path untouched, since those name
  a runtime the caller chose deliberately. The blank-command "run directly" branch
  is unchanged.

### Tests

- **extension/src/test/commandPlan.test.ts** — updated the existing win32
  blank-command-falls-to-shebang case to expect the normalized `python`; added
  four cases: explicit `python3` normalized on win32, `python3` untouched off
  win32, trailing-arg preservation, and versioned/absolute names left verbatim.
- **extension/src/test/runPlanning.test.ts** — two `planRun` integration tests
  drive `resolveInterpreter` through the live `process.platform`; their `python3`
  expectations are now platform-aware (`python` on win32, `python3` elsewhere),
  pinning the normalization at the assembly level.
- Verified: type-check clean (`npx tsc -p ./ --noEmit`); the touched test files
  (commandPlan, runPlanning) pass 34/34; adjacent `python3`-referencing tests
  (configureRunCommand, runTargets, interpreters) pass 25/25, confirming the
  command-storage and shebang-detection paths are unaffected.

### Notes

- Configure Run and the run-target detector still store the raw `python3` a user
  types or a shebang declares; normalization is applied only at run resolution, so
  stored config is not rewritten.
- Existing pins in consumer repositories that hard-code `python3` will run once
  this build is installed; before reinstalling, clearing the pin's command (or
  setting it to `python`) is the local workaround.

# Batch and native executable pins read as "not runnable"

A pin for a `.bat`, `.cmd`, `.exe`, or `.com` file with no explicit run command, no configured per-extension interpreter default, and no `#!` shebang was reported by `isRunnable` as not runnable, so the run command opened the file instead of executing it — even though the assembled command line (a blank interpreter prefix + the bare file path) already executes correctly under every consumption path (integrated terminal, background `shell:true` spawn, external-window PowerShell wrapper), because Windows resolves these extensions off `PATHEXT` with no interpreter needed.

## Finish Report (2026-08-11)

### Root cause

`isRunnablePlan` (`extension/src/exec/commandPlan.ts`) gated runnability on three conditions only: an explicit `exec.command`, a configured `saropaWorkspace.interpreterDefaults` entry for the extension, or a `#!` shebang. Extensions that are natively executable by the Windows shell — `.bat`, `.cmd`, `.exe`, `.com` — satisfy none of these by default, so a freshly-pinned batch file with no prior configuration read as a plain document. `resolveInterpreter` was already correct (a blank prefix + bare path is exactly what these extensions need), so the defect was confined to the runnability gate, not the actual run assembly.

### Fix

Added a `WINDOWS_NATIVE_EXECUTABLE_EXTS` set (`.bat`, `.cmd`, `.exe`, `.com`) to `commandPlan.ts`, exposed as `isNativelyExecutable(ext, platform)`, and a `platform: NodeJS.Platform` parameter to `isRunnablePlan`, so these extensions count as runnable only on `win32` (they are not natively executable scripts on other platforms). The one runnability call site, `isRunnable` in `extension/src/exec/runPlanning.ts`, now passes `process.platform`. The set is deliberately hardcoded rather than derived from `process.env.PATHEXT` (as `interpreterDetect.ts`'s `findOnPath` does): `commandPlan.ts` is the pure/no-IO layer, and since the check only gates a UI hint (the shell still honors the real `PATHEXT` at run time regardless of what this function reports), a customized `PATHEXT` at worst under-reports one extra extension as "not runnable" rather than causing an actual run failure.

A second, related defect surfaced during review: the Configure Run panel's "empty command box" hint (`configureRun.interp.defaultHintNone`, "Empty opens the file — its type has no interpreter") was still shown for a `.bat`/`.cmd`/`.exe`/`.com` pin with a blank prefix, now actively misleading since that blank prefix runs the file. Added a `defaultHintKind(prefix, ext, platform)` pure function (`commandPlan.ts`) returning a `"prefix" | "native" | "none"` tag — the same `isNativelyExecutable` check `isRunnablePlan` uses, so the runnable gate and the panel hint cannot disagree — and a new `configureRun.interp.defaultHintNative` l10n string ("Empty runs the file directly — {ext} needs no interpreter.") that `configureRunPanel.ts` selects via the tag.

### Verification

- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundles clean.
- `npm test` — 1216 tests pass, 0 fail, including new coverage: `commandPlan.test.ts` (win32-true / non-win32-false for all four extensions at the pure layer, plus `isNativelyExecutable` and `defaultHintKind` unit tests) and `runPlanning.test.ts` (an integration-layer test asserting `isRunnable` against the real `process.platform`, to catch a future refactor that stops threading `platform` through from `runPlanning.ts`).
- A deep-review pass (delegated review agent, `general-purpose`/sonnet) traced all three run-consumption paths (terminal, background spawn, external PowerShell wrapper) to confirm a blank-prefix `.bat`/`.cmd` executes correctly on each.
- Empirically verified on the real Windows host (not just reasoned about): a probe `.bat` was executed via `& "<path>"` — the exact call-operator form `buildWindowsStartup` embeds for the external-window path — and printed its expected output, confirming that path executes rather than opens the file. The `cp.spawn(commandLine, {shell:true})` background path could not be empirically re-verified in this sandboxed session (`spawn cmd.exe ENOENT` — a tool-sandbox restriction on spawning subprocesses from Node, reproduced even for `cmd /c echo hello` via plain `spawn`, while the same command ran fine invoked directly from PowerShell); this path is unchanged pre-existing behavior already relied on elsewhere in the codebase (`actionRunner.ts`, `backgroundRunner.ts`), not new to this change.

### Known gaps

- Not manually verified against the actual packaged extension in a dev host (no VS Code host available in this session) — verified by type-check, unit tests, empirical shell probing, and code-path tracing.
- The native-extension set is a conservative subset of what `PATHEXT` can contain on a customized Windows machine (e.g. `.VBS`, `.WSF`, `.MSC`, `.JS` if added); those remain "not runnable" (and show the generic "no interpreter" hint) even though the shell would still run them.
- Whether any existing user's `.vscode/saropa-workspace.json` has a `.bat`/`.exe` pin with `exec.command` deliberately left unset, expecting it to stay non-runnable, is unconfirmed — this change silently flips that pin's runnable status and its Configure Run hint.

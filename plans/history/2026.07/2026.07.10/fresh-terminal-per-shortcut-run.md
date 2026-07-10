# Every shortcut run gets its own terminal

A shortcut run routed to the integrated terminal reused one shared `vscode.Terminal`
singleton across every run in the window. Launching a second shortcut while an earlier
one was still busy (a long-running process, or a prompt waiting on stdin) sent the
second shortcut's command line into the first shortcut's still-open terminal instead of
opening its own — visibly "pasted into the wrong window."

## Defect

`terminalRunner.ts`'s `runInTerminal` cached a single module-level `vscode.Terminal` and
reused it for every call, `cd`-ing into the new cwd only when it differed from the
terminal's last known directory. This was correct for a single shortcut run to
completion before the next started, but broke the moment two runs overlapped: the
second run's `sendText` landed in whichever terminal was already open, mid-output from
the first run, with no isolation between unrelated shortcuts.

An intermediate fix keyed the cached terminal by shortcut id (so different shortcuts
got different terminals, but repeat runs of the SAME shortcut still reused one tab) and
was mistakenly committed mid-session by a separate process. It did not fully resolve the
report: a repeat run of the same shortcut still landed in its previous, already-used
terminal, which read as the same bug from the user's side.

## Change

- `runInTerminal` (`extension/src/exec/terminalRunner.ts`) now creates a brand-new
  `vscode.window.createTerminal(...)` on every call, with no caching or keying at all.
  Because the terminal is created already rooted at its `cwd`, no `cd` is ever sent.
- `createNamedTerminal` was split out as the shared terminal-construction helper (name
  prefix + cwd + env), so the always-fresh contract in `runInTerminal` and a caller that
  legitimately needs to hold onto one terminal across several sequential sends share one
  source of truth for the terminal's display name.
- A macro's `shell` steps run strictly in order within a single dispatch, so they now
  share ONE terminal across the macro's own steps (created lazily on the first shell
  step, threaded through the step loop) rather than opening one tab per step. This does
  not reintroduce the original bug: the shared terminal is scoped to one macro
  invocation and is never reused by a different run or a different shortcut.
- `registerTerminalCleanup` and `sameDirectory` were deleted along with the reuse/cache
  they existed to support, and every call site that threaded a shortcut/pin id through
  purely to key the old cache (`runShellAction`, `runMacro`/`runMacroStep`,
  `notifyFailure`/`notifyPortBlocked`/`notifyCompletion` in `backgroundRunner.ts`) had
  that parameter removed rather than left unused.
- `package.nls.json`'s `config.terminalName.description` was corrected from "Name of the
  reused integrated terminal" to describe it as a base name for a freshly created
  terminal, matching the new behavior.

## Review outcome

An independent read-only review of the diff and the `test/` tree found the removal
clean (no orphaned parameters, no dangling imports, no stale reuse-era comments) and
raised one substantive finding: making every `runInTerminal` call unconditionally fresh
also fanned a macro's sequential shell steps out across one terminal tab per step,
which was a side effect of the blanket "always fresh" rule rather than an intended
change to macro behavior. Fixed by giving a macro run its own single terminal, shared
across its own steps only, as described above. A second, minor finding — a stale
setting description in `package.nls.json` — was fixed in the same pass.

## Verification

- `npx tsc -p ./ --noEmit` from `extension/` — zero errors.
- `node esbuild.js` — bundle builds.
- `npm test` (`node --test` over the esbuild-bundled unit tests) — full suite passes
  (936 tests). No existing assertion was broken by the change: `terminalRunner.ts`'s
  `runInTerminal` and the new `createNamedTerminal` are not unit-tested, consistent with
  the existing, already-documented project convention that terminal/child-process
  creation needs the real extension host and is exercised manually instead (see the
  header comments in `terminalRunner.test.ts` and `actionRunner.test.ts`). The four
  `sameDirectory` tests were removed along with the function.
- Not yet verified by a human: the actual VS Code behavior of opening N shortcuts in
  quick succession and confirming N separate terminal tabs, and of running a macro with
  multiple shell steps and confirming its steps land in one shared tab. Requires an
  Extension Development Host reload (or a rebuilt `.vsix` reinstall) to pick up the
  change — an already-running extension instance keeps its previously loaded code.

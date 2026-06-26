# Plan — #1 The "Port Blocked" Savior (Auto-Unwedge)

## Pain
A "Start Dev Server" pin fails with `EADDRINUSE` because a zombie process from a
crashed run still holds the port. The user opens a terminal, finds the PID, kills it
by hand, and re-runs.

## Target behavior
When a **background** run finishes in failure and its captured output contains an
"address already in use" error naming a port, raise a toast:
*"Port 3000 is held by node (PID 4512). [Kill process & retry]"*. The action kills
that PID after a confirm and re-runs the pin.

## Approach
This extends the existing background-run completion path. `exec/runner.ts` already
captures combined output into `captured`, records it, and on failure computes
`detectFixCommand(captured)` before calling `notifyCompletion(...)` (around the
`runInBackground` tail, near the `extractAndCopy` / `detectFixCommand` calls). Add a
sibling detector that runs on failure and, when it matches, offers the kill+retry
action instead of (or alongside) the existing fix-command action.

### New module `exec/portUnwedge.ts`
- `detectBlockedPort(output: string): number | undefined` — match the port from the
  common phrasings: `EADDRINUSE`, `address already in use`, `:3000`, Node's
  `listen EADDRINUSE: address already in use :::3000`, and the dotnet / Python
  variants. Return the first port found.
- `findPortHolder(port): Promise<{ pid: number; name: string } | undefined>` —
  resolve the owning process cross-platform:
  - Windows: `netstat -ano | findstr :<port>` → PID column; then
    `tasklist /FI "PID eq <pid>" /FO CSV` → image name.
  - macOS/Linux: `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` → PID; then `ps -p <pid> -o comm=`.
  Spawn via `child_process.execFile` with a short timeout; parse defensively (return
  undefined on any miss). Never shell-interpolate the port without validating it is an
  integer.
- `killProcess(pid): Promise<boolean>` — `process.kill(pid, 'SIGTERM')`, fall back to
  `taskkill /PID <pid> /F` on Windows / `kill -9` after a grace timeout.

### Runner hook
In the background-completion failure branch, after computing the existing fix action:
`const port = detectBlockedPort(captured)`. If set, resolve the holder and pass a
`portBlock` descriptor into `notifyCompletion` so the toast shows the
**Kill process & retry** action. The action handler: modal confirm naming PID + image
→ `killProcess` → on success re-dispatch the pin's run (reuse the same run entry point
the toast's existing retry/fix path uses).

## Files & changes
- `exec/portUnwedge.ts` (new) — detection, holder lookup, kill.
- `exec/runner.ts` — call the detector in the background failure branch; thread a
  `portBlock` option through `notifyCompletion` and wire the toast action.
- `package.nls.json` / `i18n/locales/en.json` — toast text + action labels +
  confirm copy (name the port, PID, image; name the pin being retried).

No model, store, or tree changes.

## Deviations / limits
- Detection is **background-run only** — terminal and external-window runs do not
  capture output, so their EADDRINUSE cannot be read. State this in the finish report;
  the toast simply never appears for those locations.
- Port→PID lookup depends on `netstat`/`lsof` being present. When the holder cannot be
  resolved, fall back to a toast that names the port and offers to open a terminal
  rather than a kill action.

## Risks / blast radius
- **Kills an OS process** — must be gated behind an explicit modal confirm that names
  the exact PID and image. Never auto-kill. Refuse to kill PID 0/1 or the extension
  host's own PID.
- Cross-platform parsing is the fragile part — guard every parse and degrade to "could
  not identify the process" rather than killing the wrong PID.

## Verification
`tsc` + `esbuild`; manual: start a process on a port, run a background pin that binds
the same port, confirm the toast names the right PID and the kill+retry frees it.

## Complexity & risk
Moderate complexity (cross-platform process lookup), elevated risk (process kill).
Self-contained to the runner failure path + one new module.

## Finish Report (2026-06-25)

Shipped as planned. A background pin that fails on a held port now surfaces a
**Kill process & retry** toast that names the exact process and PID, gated behind a
modal confirm, and re-runs the pin once the port is freed.

### What changed
- **New module `extension/src/exec/portUnwedge.ts`** — host-free (no `vscode`
  import), so the detection and parsing are unit-testable without the extension
  host:
  - `detectBlockedPort(output)` — reads the port only from lines carrying an
    in-use marker (`EADDRINUSE` / `address already in use`), so an unrelated
    `:port` elsewhere in the output cannot trigger a kill offer. Covers Node
    `:::3000` / `host:port`, dotnet `http://host:5000:`, and `port N`. Rejects
    out-of-range ports and degrades to `undefined` when no port is named (e.g.
    Python's `[Errno 98] Address already in use`, which prints no port).
  - `findPortHolder(port)` — Windows `netstat -ano` + `tasklist`, macOS/Linux
    `lsof` + `ps`, all via `execFile` (no shell). The port is validated as an
    integer before it reaches any argument, so there is no interpolation surface.
    Pure parsers `parseNetstatPid` / `parseTasklistImage` / `parseLsofPid` are
    exported for tests; the Windows parser reads the local-address column and
    requires `TCP LISTENING`, so a foreign-address match or an `ESTABLISHED`
    client row is never mistaken for the holder.
  - `killProcess(pid)` — graceful `SIGTERM`, then escalates to `taskkill /F` /
    `SIGKILL` after a grace window, and verifies the PID is actually gone before
    returning `true`, so a still-held port is never reported as freed.
    `isKillablePid` refuses 0, 1, non-integers, and the extension host's own PID.
- **`extension/src/exec/runner.ts`** — the background-completion failure branch now
  routes through `notifyFailure`, which resolves the actionable cause before its
  toast. A held port (this feature) takes precedence over a suggested fix command
  (WOW #12). `notifyPortBlocked` offers **Kill process & retry** when the holder is
  known (the kill itself gated by `confirmKillAndRetry`'s modal naming PID + image)
  or **Inspect Port** — a terminal pre-filled with the lookup command — when it
  cannot be identified. A `retry` thunk is threaded through `runInBackground` from
  both the file-pin and shell-recipe call sites so a freed port re-dispatches the
  same run; the file-pin retry re-runs from the original pin so interactive
  `${prompt:}`/`${pick:}` tokens are re-resolved.
- **`extension/src/i18n/locales/en.json`** — ten `portUnwedge.*` keys (block toast,
  unknown-holder toast, action labels, modal confirm body/action, freed/failed
  toasts, unknown-process label).
- **`extension/src/test/portUnwedge.test.ts`** — 18 unit tests over the host-free
  core (detection across the phrasings, the false-trigger guards, each parser, and
  the kill-safety guard).
- **Root `CHANGELOG.md`** — one Added entry under `[Unreleased]`.

### Deviations from the plan
- The `retry` is a threaded callback (a positional parameter on `runInBackground`)
  rather than a `portBlock` descriptor passed into `notifyCompletion`. `notifyFailure`
  owns the async holder lookup instead, which keeps `notifyCompletion` synchronous
  and leaves the existing success / fix-command paths untouched.
- `killProcess` returns `boolean` as planned, but adds an internal verify-and-escalate
  step so a reported "freed" port is never a false positive.

### Limits (carried from the plan)
- **Background runs only.** Terminal and external-window runs do not capture output,
  so their `EADDRINUSE` cannot be read and the toast never appears for those
  locations — by design.
- **Holder lookup depends on `netstat`/`lsof` being present.** When the holder cannot
  be resolved, the toast names the port and offers the manual **Inspect Port** path
  instead of a kill action.

### Verification
- `npx tsc -p ./ --noEmit` — clean.
- `node esbuild.js` — bundle builds.
- `npm run test:unit` — all 18 `portUnwedge` tests pass. Two failures in
  `pinStore.test.cjs` are a separate workstream's schema-version change (2 vs 3),
  outside this change set and not investigated.

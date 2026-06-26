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

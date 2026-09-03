# Remote / virtual — run a pinned script on the remote host

Roadmap: Later / Exploratory. Pin + open on remote/virtual filesystems **shipped**
(`plans/history/2026.06/2026.06.25/remote-virtual-resources.md`); running the script on
the remote host remains.

## Verified current state

- **Pin + open works remotely.** A global pin stores the full resource URI
  (`globalStoredPath` / `parseGlobalPath` in `pinStore.ts:104-121`); open/peek/reveal go
  through `resolveUri` and reach the right filesystem.
- **Run is local-only.** `runner.ts` assembles a local command line and executes via
  `cp.spawn(..., { shell: true })` (`runner.ts:454-458`); `runInTerminal` calls
  `createTerminal()` with **no scheme/authority awareness** (`runner.ts:588-604`). A pin
  targeting a Remote-SSH/WSL/container file runs the command on the **local** machine —
  wrong host.

## Remaining work

1. **Detect the pin's host.** From the pin's resolved URI, determine whether it lives on
   a remote authority (`vscode-remote://`, WSL, container, virtual provider) vs local
   `file:`. This is the gate for routing.
2. **Route the run to the right terminal.** When VS Code is attached to the matching
   remote and the pin is remote-scoped, the integrated terminal already runs on the
   remote host — so route remote runs through `createTerminal` (the integrated terminal),
   not through the local `cp.spawn` background/external paths, which are inherently local.
   The background output-channel and external-window run modes cannot target a remote host
   and must be disabled (with a clear message) for remote pins.
3. **Path + cwd correctness on the remote.** The command line, `cwd`, and
   `$workspaceRoot` must resolve in the remote's filesystem, not the local one — reuse
   the URI the pin already stores rather than its `fsPath`.
4. **Graceful mismatch handling.** If the pin is remote but the current window is not
   attached to that remote (or is a different remote), do not silently run locally —
   surface a clear, named message ("This pin targets <host>; open a window on that host
   to run it") and refuse, rather than executing against the wrong machine.

## Approach

- Reuse the URI already persisted by the shipped pin+open work — the single source of
  truth for the pin's host is its stored URI; the runner must read it, not `fsPath`.
- The integrated terminal is the only run mode that transparently reaches the remote
  host; constrain remote pins to it and disable the local-only modes with a reason.
- This is evaluated against the remote-terminal model's limits — confirm against the VS
  Code remote/terminal API before committing the routing (no blocker/claim without
  reading the API).

## Acceptance criteria

- A remote-scoped pin runs on the remote host's integrated terminal with correct `cwd`
  and path resolution.
- Background and external-window run modes are disabled for remote pins with a clear,
  named message (no silent local fallback).
- A remote pin in a non-matching window refuses with a message naming the target host
  rather than running locally.

## Dependencies

- Builds on the shipped remote pin+open URI storage. No blocking dependency.

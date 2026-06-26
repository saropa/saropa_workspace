# Plan — #23 Run Rollback (The "Undo Macro" Button)

## Pain
A macro scaffolds 50 files, but a typo in the interactive `${prompt:FeatureName}` named
them all wrong. Now you hunt down and delete 50 files by hand.

## Target behavior
Saropa snapshots git working-tree state immediately **before** a macro/shell pin runs.
Afterward, a pin's context menu gains **Revert Last Run**, which does a surgical
`git checkout` / `git clean` on **only** the files that run changed, undoing the mess.

## Approach
### Snapshot (`exec/runRollback.ts`, new)
- Before a runnable macro/shell pin executes (hook in `exec/runner.ts`, at the same
  dispatch point that records run status), capture a snapshot for the pin's repo:
  `git status --porcelain=v1` → a map of path → status. Store it in an in-memory
  registry keyed by pin id (session-scoped; mirror `runOutputs`/`runStatusRegistry`).
- After the run completes, capture a second `git status`. The **delta** (paths newly
  modified, added, or deleted relative to the pre-snapshot) is the run's footprint. Store
  `{ pinId, changed: string[], created: string[], endedAt }`.

### Revert
- `saropaWorkspace.revertLastRun` — for the pin's recorded footprint:
  - Modified/deleted-then-present tracked files → `git checkout -- <files>`.
  - Newly created (untracked) files → `git clean -f -- <files>` (NOT `-d` unless the run
    created whole directories; compute that from the delta).
  - Modal confirm first, listing the exact file count and a sample, and naming the pin
    and its run time. Never touch a file outside the recorded footprint.
- Only available when a footprint exists for the pin this session; the menu item is gated
  on that (a context value or a checked-at-invocation guard with a "nothing to revert"
  message).

## Files & changes
- `exec/runRollback.ts` (new) — snapshot/delta registry + revert.
- `exec/runner.ts` — pre/post snapshot hooks around macro/shell runs (guard to repos
  only; skip when not a git repo).
- `commands/pinCommands.ts` — `revertLastRun` command + registration.
- `package.json` / nls / en.json — command, context-gated menu entry, confirm + result
  strings.

## Deviations / limits
- Only files **inside the git working tree** can be reverted; a run that wrote outside the
  repo (absolute paths, /tmp) is out of scope — the footprint is git-derived. State this.
- A run that modified a file the user *also* hand-edited in the same window is ambiguous:
  the revert would discard both. The confirm must warn when reverting modified (not just
  created) files, and prefer `git stash` of the footprint over a hard checkout if a safer
  recovery is wanted (decision point: hard checkout is simpler and matches the pitch;
  document that it discards).

## Risks / blast radius
- **Destructive git operations** (`checkout`, `clean`) — the single most dangerous item
  in the backlog. Hard requirements: modal confirm naming the file list; operate strictly
  on the recorded footprint; never run on a dirty path the snapshot did not attribute to
  this run; refuse if the repo state changed in a way that makes the delta unreliable
  (e.g. branch switched since the run).
- Snapshot cost: `git status` per run — acceptable, but skip for non-git or huge repos
  with a size guard.

## Verification
`tsc` + `esbuild`; manual on a throwaway repo: run a script that creates files, Revert
Last Run, confirm only those files are removed and unrelated changes are untouched;
repeat for a script that modifies a tracked file.

## Complexity & risk
High risk (destructive, irreversible if mis-scoped), moderate complexity. Strongest
candidate for an explicit, named confirm and a conservative "refuse when unsure" stance.

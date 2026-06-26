# Plan — #15 The Git Conflict Command Center

## Pain
A rebase leaves eight conflicted files. The native SCM view works, but the
"open → find conflict → test → mark resolved" loop means jumping around the UI.

## Target behavior
The moment the repo enters a conflicted state, a synthetic **Active Conflicts** group
appears at the top of the Pins view listing every conflicted file, plus a macro pin
**Accept current for all & continue**. When the merge/rebase finishes, the group
vanishes.

## Approach
This mirrors how recipe groups are injected: synthetic, never persisted, present only
when they have content. See `RECIPE_GROUPS` / the recipe-group injection in
`model/pinStore.ts` and the separate "Recipes" rendering — build an analogous
conflicts group.

### Conflict detection (`exec/gitConflicts.ts`, new)
- `conflictedFiles(folder): Promise<string[]>` — read `.git` directly (consistent with
  `systemEvents.ts`): the presence of `.git/MERGE_HEAD` (merge), `.git/rebase-merge` or
  `.git/rebase-apply` (rebase), or `.git/CHERRY_PICK_HEAD` signals an in-progress op.
  For the file list, parse `git status --porcelain=v1` for `UU`/`AA`/`DD`/`AU`/`UA`/`UD`/
  `DU` codes. (A single `git` invocation here is acceptable; or parse the index, but
  porcelain is simpler and stable.)
- A `ConflictWatcher` — `FileSystemWatcher` on `.git/MERGE_HEAD`, `.git/rebase-merge/**`,
  `.git/index` — debounced, firing `onDidChangeConflicts`. Wire in `extension.ts`;
  refresh the tree on fire.

### Tree injection (`model/pinStore.ts` + `views/pinsTreeProvider.ts`)
- The store exposes `getConflictGroup(): { files: Uri[] } | undefined` (cached, refreshed
  by the watcher). When present, the provider prepends a synthetic top-level
  **Active Conflicts** group (above the Recent / scope roots) whose children are the
  conflicted files (each opens to the file; a conflicted file already shows VS Code's
  inline conflict UI).
- Add a macro/command child **Accept current & continue** that runs, after a modal
  confirm: `git checkout --ours -- <files>` then `git add <files>` then the continue
  step (`git rebase --continue` / `git merge --continue`). Implemented as a command, not
  a stored pin, so it is never persisted.

## Files & changes
- `exec/gitConflicts.ts` (new) — detect state + file list + watcher + event.
- `model/pinStore.ts` — cache the conflict set; expose it; refresh on the event.
- `views/pinsTreeProvider.ts` — inject the synthetic group when conflicts exist.
- `views/pinTreeItem.ts` (or a small new item class) — the conflict-file row + the
  macro row.
- `commands/...` — the "accept current & continue" command (confirm-gated, destructive).
- `package.json` / nls / en.json — command, group label, strings.

## Deviations / limits
- "Accept current for all" is inherently destructive (discards incoming changes for the
  listed files) — gate behind a modal confirm that names the file count and the exact
  git operation, and run it only on the conflicted files, never the whole tree.

## Risks / blast radius
- Touches the **shared tree provider** with a new synthetic group — coordinate with the
  recipe-group injection and the #17/#28 filter (the conflicts group should be exempt
  from text/tag filtering or always shown).
- The git continue step varies (merge vs rebase vs cherry-pick) — detect which op is in
  progress and call the matching `--continue`; if ambiguous, stop after staging and tell
  the user to continue manually rather than guessing.

## Verification
`tsc` + `esbuild`; manual: create a merge conflict, confirm the group appears with the
files, resolve, confirm it vanishes; test the accept-all path on a throwaway repo.

## Complexity & risk
Moderate-to-high (git state machine + destructive macro + shared tree). The detection
and disappearance are low-risk; the "accept & continue" macro is the risky part and must
be confirm-gated and op-aware.

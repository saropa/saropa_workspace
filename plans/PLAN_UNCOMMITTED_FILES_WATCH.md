# Plan: watch for uncommitted files/folders

The last line of
[`PLAN_FILE_AND_FOLDER_WATCH.md`](./history/2026.06/2026.06.26/PLAN_FILE_AND_FOLDER_WATCH.md)
— "can do the same for not-github committed files/folders" — is a separate engine
from the new/changed folder watch that already shipped. This plan covers it.

## Why it is a distinct engine, not a mode on the folder watch

The shipped folder watch (`FolderWatchEngine`) answers "did a file appear or change
on disk?" by snapshotting **modified-times** and diffing them. "Is this file
uncommitted?" is a different question with a different source of truth: git's index
and working tree. An mtime diff cannot answer it —

- a file can be brand-new on disk yet already committed (cloned, pulled), or
- old on disk yet never committed (sitting untracked for months), and
- `git add` / `git commit` / `git stash` change a file's committed-ness **without
  touching its mtime at all**, so an mtime watcher would never fire on the exact
  events this feature cares about.

So this needs to read git state, and it must react to git operations, not file
saves. Bolting a `"mode": "uncommitted"` onto the existing engine would force that
engine to carry a second, unrelated data source and trigger model. Keep them
separate; share only the persisted-watch UX shell where it genuinely fits.

## Goal

Let the user say "tell me when this folder (or the repo) has uncommitted files,"
and be told both on startup and live:

- **On startup:** if files were left uncommitted when the window closed — or new
  untracked files were written while it was closed — toast them on open.
- **Live:** when the working tree gains an untracked/modified file under the
  watched path, toast it. When everything under the path becomes clean again
  (committed/stashed/discarded), optionally toast the "all clear" once.

"Uncommitted" means, by git's own categories: **untracked** (not in the index and
not ignored), **modified** (tracked, working-tree differs from index), and
**staged** (index differs from HEAD). `.gitignore`d files are never reported —
ignored is the user's explicit "don't track this," and surfacing it would make the
watch noise. This is the key correctness point: the feature must honor
`.gitignore`, which is exactly why we read git rather than walking the filesystem.

## Design: how to read git state

Two viable sources. Recommendation: **the VS Code Git extension API**, with
`git status --porcelain` spawning as a documented fallback.

### Option A (recommended): the built-in Git extension API

VS Code ships a `vscode.git` extension that exposes a typed API: `getAPI(1)` →
`repositories: Repository[]`, each with `state.workingTreeChanges`,
`state.indexChanges`, `state.untrackedChanges` (arrays of `{ uri, status }`), and a
`state.onDidChange` event that fires on every git operation.

- **Pro:** event-driven (no polling, no spawn), already honors `.gitignore`, gives
  the exact change lists, and fires precisely on `add`/`commit`/`stash`/`checkout`.
  It is the same data the Source Control view shows, so our toast can never
  disagree with what the user sees there.
- **Con:** depends on the git extension being present and activated (it is built in
  and on by default, but a user can disable it), and requires importing its `.d.ts`
  type surface.
- **Pre-implementation verification (do this before writing code, per
  NO-BLOCKER-WITHOUT-ANALYSIS):** read the git extension's published `git.d.ts`
  (vendored type stub, not memory) and confirm the exact names of
  `workingTreeChanges` / `untrackedChanges` / `indexChanges`, the `Status` enum
  values, and the `onDidChange` signature for API version 1. Confirm
  `untrackedChanges` already excludes ignored files (it should; verify).

### Option B (fallback): spawn `git status --porcelain=v1 -z`

There is precedent: `exec/projectStats.ts` already does `execFile("git", …)` for
`ls-files`/`log`. Parse porcelain output (`??` = untracked, ` M`/`M ` = modified/
staged, etc.), filtering to the watched subpath.

- **Pro:** no extension dependency; works wherever `git` is on PATH.
- **Con:** must be polled or driven off a `.git` watcher (no native event), spawns
  a process per check, and we re-implement status parsing. `--porcelain` does honor
  `.gitignore` by default (untracked-but-ignored are not listed unless
  `--ignored`), so correctness is fine; the cost is the polling/process model.

**Decision:** use Option A when `vscode.extensions.getExtension('vscode.git')`
resolves and its API is available; fall back to Option B only when it is not, gated
so a no-git environment simply has the feature inert (the watch can be created but
reports "git unavailable" once, never repeatedly).

## Trigger model

- **Option A:** subscribe to each repo's `state.onDidChange`, debounced (~400 ms,
  matching `GitEventWatcher`), recompute the uncommitted set under each watched
  path, diff against the cached set, toast the delta.
- **Startup:** the git extension populates repo state asynchronously after
  activation; wait for the first `onDidChange` (or a short settle delay), then run
  the same diff against the cached baseline so closed-window changes surface.
- **Option B fallback:** reuse the existing `.git/**` `GitEventWatcher` signal (or a
  low-frequency poll) to know when to re-run `git status`.

## Model changes

Reuse the persisted-watch shell, do not fork a parallel store. Extend the watch
model in `model/folderWatch.ts` so an uncommitted watch rides the same list/manage
UX:

- Add `"uncommitted"` to a watch's kind. Cleanest is a discriminated split rather
  than overloading `FolderWatchMode`: introduce `kind: "fs" | "git"` (or a separate
  `GitWatch` interface in a sibling `model/gitWatch.ts`) so the fs-mtime fields
  (`glob`, `mode: new|changed`) and the git fields don't bleed into each other. A
  `git` watch carries: `target` (folder or repo root it scopes to), and a
  `report` set choosing which categories count (`untracked` / `modified` /
  `staged`), defaulting to all three.
- **Baseline cache:** instead of `relPath -> mtime`, a git watch caches the **set of
  uncommitted relative paths** last seen (a `string[]` / `Record<path, status>`).
  The diff is set membership ("which uncommitted paths are new since last time"),
  not mtime comparison. Store it under the same baselines key, separate value shape.
- `FolderWatchStore` already separates the watch list from baselines on two
  globalState keys; the git watch reuses both with its own value shapes. No new
  store class.

## Commands / UX

- New command **Watch for Uncommitted Files...** (`saropaWorkspace.watchUncommitted`)
  — Explorer folder context + palette. Picks the folder (or offers "whole repo"),
  then the category set, then stores the git watch.
- The existing **Manage Folder Watches...** hub lists git watches alongside fs
  watches; the row description names the kind ("uncommitted — untracked+modified")
  so the two are distinguishable. Enable/disable/remove already work generically.
- **Toast (UX rules):** name the files and the count, e.g. *"3 uncommitted in
  `bugs`: a.md, b.md, c.md"* with an **Open Source Control** action
  (`workbench.view.scm`) rather than opening a single file, since the natural next
  step for "you have uncommitted work" is the SCM view. Honor the
  no-first-person-voice and name-the-item rules already applied to the fs watch.
- Reuse the `folderWatch.*` l10n namespace; add `folderWatch.uncommitted*` keys.

## Edge cases

- **No git / git extension disabled:** the watch is inert; report the limitation
  **once** to the output channel, never a repeating toast (matches the fs watch's
  `scanError` discipline).
- **Multi-root / nested repos:** scope each watch to the repo containing its
  `target`; a watch whose target spans no repo is inert.
- **`.gitignore` correctness:** ignored files must never appear — this is the whole
  point of reading git. Add a test fixture with an ignored file and assert it is
  excluded.
- **Detached HEAD / mid-rebase:** staged/working categories still read correctly
  from the extension API; do not special-case unless verification shows otherwise.
- **Storm control:** debounce `onDidChange`; a rebase or a large `git add` fires
  many state changes — coalesce into one toast naming up to N files then "+M more"
  (reuse `formatFiles`).

## Testing

- **Pure diff:** a `diffUncommitted(baseline: Set, current: Set)` set-difference
  function, tested the way `diffSnapshots` is — added paths, no longer-uncommitted
  paths, empty deltas, deterministic sort. Pure, no VS Code, runs under `node
  --test`.
- The extension-API and spawn integrations are host-dependent and stay out of the
  `node --test` files until the `@vscode/test-electron` harness exists (per
  `.claude/rules/test.md`); cover them by manual smoke test in the dev host.

## Scope boundary

In: untracked/modified/staged detection under a watched path, startup + live, via
the git extension API with a spawn fallback, on the existing persisted-watch UX.

Out (call out, do not silently fold in): per-file diff previews, auto-staging or any
write to git, branch-ahead/behind ("unpushed commits" is yet another distinct
signal — that is `.git/refs` comparison, not working-tree status), and reporting
ignored files. Each is a separate follow-up if wanted.

## Pre-build checklist

1. Vendor and read the git extension `git.d.ts`; confirm the API v1 field names and
   that `untrackedChanges` excludes ignored files. Do not write code against
   remembered names.
2. Confirm `vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1)` is the
   correct entry point in this VS Code engine version (check `engines.vscode` in
   `package.json`).
3. Only then implement, following the model/engine/commands split above.

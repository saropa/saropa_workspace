# PROPOSAL: Configurable debounce after git stash/rebase in publish script

**Status: Closed**

<!-- Status values: Open → Accepted → In Progress → Closed -->

Created: 2026-09-03
Type: Configuration / Tooling
Related area: Scripts

---

## Summary

When the publish script stashes, rebases, and pops during the remote-sync or Dependabot-merge steps, VS Code's file watcher fires on every intermediate state — showing archived bug files as "7 new" and then removing them again within milliseconds. A configurable debounce/sleep between the rebase and the stash-pop would let VS Code settle before the working tree returns to its final state, eliminating the false-positive churn in the file explorer and source-control panel.

---

## Motivation

During a real publish run on 2026-09-03, the script detected a divergence (local commits + Dependabot merges on origin) and recommended `git stash -u && git rebase origin/main && git stash pop`. VS Code's file watcher picked up the intermediate rebase states — specifically the replay of the archive commit that moves 7 bug files from `bugs/` to `plans/history/` — and surfaced "7 new, 3 changed in bugs" notifications. This looked like the rebase had resurrected closed bugs, causing alarm and wasted investigation time. The final working-tree state was correct, but the transient noise was indistinguishable from a real problem.

This applies to any project where the publish script performs stash/rebase/pop cycles and VS Code is open on the same workspace.

---

## Behavior

### Current behavior

The stash/rebase/pop sequence does not exist in the publish script yet. When the script detects a divergence, it recommends the commands for the user to run manually. Once automated, `git stash -u && git rebase origin/main && git stash pop` would run as a single chained command with no delay, and VS Code would process filesystem events from every intermediate commit replay.

### Proposed behavior

The publish script wraps the stash/rebase/pop sequence with a configurable delay (in seconds) between the rebase completing and the stash pop. Default: 3 seconds. Set to 0 to disable.

Configuration via CLI flag:

```bash
python scripts/publish.py --rebase-debounce 5
```

The script would:
1. `git stash -u`
2. `git rebase origin/main`
3. Sleep for `rebase_debounce_seconds` (lets VS Code settle on the rebased state)
4. `git stash pop`

---

## Edge Cases

1. **Debounce set to 0** — no sleep, current behavior preserved
2. **Rebase fails** — skip the sleep, do not pop the stash, report the error as today
3. **No unstaged changes** — skip the stash/pop entirely, rebase directly (no debounce needed)
4. **Large debounce value** — cap at 10 seconds to prevent accidental publish stalls

---

## Alternatives Considered

1. **Disable VS Code file watcher during rebase** — not controllable from the script; would require a VS Code extension command
2. **Use `git rebase --quiet`** — does not affect filesystem events, only terminal output
3. **Push local commits before merging Dependabot PRs** — solves the divergence case but not the general stash/rebase/pop noise; also changes the publish step ordering which may have other implications
4. **Document the behavior** — low cost but does not prevent the alarm; users will still see the churn and worry

---

## Decision

Accepted 2026-09-03. Default debounce is 3 seconds. Implement as a `--rebase-debounce` CLI flag on `publish.py`, threaded into `_git_ops.py` where the stash/rebase/pop automation will live.

---

## Implementation Notes

Implemented in `scripts/modules/_git_ops.py` as `sync_with_remote(rebase_debounce_seconds)`:
1. `git fetch origin`, then `git rev-list --left-right --count HEAD...origin/main` to detect divergence; returns immediately if already up to date
2. Stashes (`git stash -u`) only if the working tree is dirty
3. `git rebase origin/main`
4. On rebase failure: reports the error, leaves the stash intact, returns failure — never pops onto a broken rebase
5. `time.sleep(rebase_debounce_seconds)` (clamped to `[0, 10]`) — lets VS Code's file watcher settle, skipped entirely when nothing was stashed
6. `git stash pop`

Wired into `scripts/modules/_workflow.py`'s full-publish pipeline as the first strict-mode step ("Git sync"), and exposed as `--rebase-debounce SECONDS` (default 3) on `scripts/publish.py`.

Unit tests: `scripts/tests/test_git_ops.py` (mocks `run`/`time.sleep`; covers up-to-date skip, clean-tree rebase without stash, dirty-tree stash/rebase/sleep/pop ordering, debounce clamp at both ends, and rebase-failure leaving the stash unpopped).

---

## Commits

- `9922c66` — feat: debounce rebase-triggered file-watcher churn in publish script

---

## Finish Report (2026-09-03)

The publish script had no automated recovery from a diverged `origin/main` — a divergence (e.g. local commits plus a merged Dependabot PR) previously required the operator to run `git stash -u && git rebase origin/main && git stash pop` by hand, and that manual sequence gave VS Code's file watcher no chance to settle between the rebase replay and the stash pop, producing a burst of false "N new" file notifications for archived files.

`sync_with_remote(rebase_debounce_seconds)` was added to `scripts/modules/_git_ops.py` and wired into the full-publish pipeline in `scripts/modules/_workflow.py` as the first strict-mode step. It fetches `origin`, compares `HEAD` against `origin/main` via `git rev-list --left-right --count`, and does nothing when already up to date. When diverged, it stashes only if the tree is dirty, rebases onto `origin/main`, sleeps for a configurable, clamped `[0, 10]` second window before restoring the stash, and leaves the stash untouched (never pops) if the rebase itself fails. The debounce is exposed as `--rebase-debounce SECONDS` on `scripts/publish.py` (default 3, matching the proposal's accepted default).

Six unit tests were added in `scripts/tests/test_git_ops.py`, mocking `_git_ops.run` and `time.sleep` to verify: the up-to-date skip path, a clean-tree rebase with no stash, the full dirty-tree stash→rebase→sleep→pop ordering, the debounce clamp at both 0 and above the 10s ceiling, and that a failed rebase never reaches the pop step. All 6 pass (`python scripts/tests/test_git_ops.py`).

`CHANGELOG.md`'s `[Unreleased]` section documents the change under Changed.

A `code-review medium` pass over the full working-tree diff (which also included an unrelated `--headless` mode feature that appeared concurrently on disk during this session, authored elsewhere) surfaced two correctness findings in that headless-mode code's interaction with the new Git-sync step — an unbounded retry loop under `--on-failure retry`, and `--on-failure ignore` allowing the pipeline to proceed past a failed rebase/stash-pop with the repo left mid-conflict — plus two simplification findings (a redundant re-import, a dead accessor). None of the four findings are in the debounce/sync code from this proposal; they were reported to the operator rather than fixed at the time, since that code was not authored as part of the initial change.

### Follow-up hardening (same day)

The two correctness findings above were fixed once the operator asked for the reflection items to be hardened (the two simplification findings — a redundant import, a dead accessor — were found already resolved by further concurrent edits before this pass started):

- **Cross-step headless-retry leak**: `_HEADLESS_RETRIED` in `modules/_utils.py` was cleared only inside `prompt_on_failure()` on a non-retry outcome, so a step that failed once, retried, and then succeeded left the flag set. The *next* step's first failure then read that stale `True` and escalated straight to abort instead of getting its own single retry. Added `reset_headless_retry()`, called at the top of `_attempt()` and `_resolve_version_interactive()` in `modules/_workflow.py` so every step starts its own retry budget.
- **`--on-failure=ignore` past an unsafe step**: `_attempt()` gained an `allow_ignore: bool = True` parameter; the "Git sync" and "Git + release" steps in `run_mode()` now pass `allow_ignore=False`, so a headless `ignore` policy can no longer wave through a failed rebase/stash-pop or a failed commit/tag/push and let the pipeline build on top of an unresolved conflict — those always abort regardless of policy.

Also hardened, from the same reflection pass, all in `modules/_git_ops.py`:

- `sync_with_remote()` now surfaces a failed `git fetch origin` as an explicit warning (previously silent, `check=False` with no follow-up), since a stale fetch could make the divergence check compare against an outdated `origin/main` and silently skip a rebase that was actually needed.
- Rebase and stash-pop failures now print the actual recovery command (`git rebase --continue`/`--abort`, or `git stash drop`) instead of a bare "resolve manually" message.
- The debounce default was named as a constant (`DEFAULT_REBASE_DEBOUNCE_SECONDS = 3`, single source of truth shared by `publish.py`'s CLI default and `run_mode()`'s parameter default) with a comment documenting it as a heuristic — VS Code batches native filesystem events over roughly a second, so 3s gives headroom on a slow disk — not a measured value; no way to measure real watcher behavior exists in this environment, so the number is unchanged but its basis is now explicit instead of an unstated assumption.
- **Unrequested feature implemented (minimal, script-side slice)**: `sync_with_remote()` now writes a `.saropa-sync.json` coordination marker (git-ignored) naming the current stage (`stash` / `rebase` / `settling` / `restore`) for the duration of an in-progress sync, cleared via `try/finally` on every exit path including failure — except a failed rebase, which clears it deliberately, since a real conflict needs to stay visible rather than being signaled as "still syncing". This is the script-side half of the brainstormed "a marker file the extension itself could watch for" — nothing in the VS Code extension consumes it yet; wiring an extension-side watcher exclusion was out of scope for this pass (a TypeScript/l10n change, not a scripts one) and is a natural next step if the false-positive churn recurs even with the debounce.

Two new test files were added: `scripts/tests/test_git_ops.py` (9 tests, up from 6 — added no-tracking-ref, fetch-failure-warns, and marker-lifecycle coverage) and `scripts/tests/test_workflow.py` (4 tests covering the retry-leak fix and the `allow_ignore` gate). All 28 tests across the three script test files (`test_quality.py`, `test_git_ops.py`, `test_workflow.py`) pass.

`CHANGELOG.md`'s `[Unreleased]` section was extended to describe the hardening and the new marker file.

# Handover — publish_headless_json
2026-09-03 13:58 EST · saropa_workspace / main · session opus-publish-headless

## Unfinished tasks
1. [pending] `_run_publish_existing()` does not call `_record_result()` — JSON output falls back to a minimal dict from `publish.py` instead of including timing data. Low priority; only affects the `publish-existing` mode's JSON output.
2. [pending] No automated tests exist for the Python publish pipeline — all behavior is verified by manual smoke tests and code inspection. A pytest suite for headless mode, retry caps, and JSON output would catch regressions.

## Completed tasks
1. **Headless mode (`--headless`)** — Added `--headless`, `--version`, `--on-failure` CLI flags to `scripts/publish.py`. All 7 interactive prompts (mode menu, version prompt, PAT entry x2, failure handler, local install) are bypassed. Verified with `--headless --mode audit` and `--headless --mode dry-run` smoke tests. Committed in `088e6a6` and `f046ad3`.
2. **JSON output (`--json`)** — Added `--json` flag that emits a single JSON object to stdout at exit. Implies `--quiet`. Subprocess output captured. `StepTimer.to_dict()` provides structured timing. `_record_result()` / `get_last_run_result()` in `_workflow.py` stores the result. Verified with both audit and dry-run modes. Committed in `f046ad3`.
3. **Unbounded retry loop fix** — `--on-failure retry` in headless mode previously caused infinite loops. Fixed with `_HEADLESS_RETRIED` flag and `reset_headless_retry()` called per step in `_attempt()`. Committed in `088e6a6`.
4. **Code review findings** — Hoisted local `is_headless` imports to top-level in 3 files. Removed dead `get_on_failure()`. Moved `_VERSION_OVERRIDE` above first use. Added `--version` without `--headless` warning. Added CONTRACT comment for `input()` guards. Suppressed logo in quiet mode. All committed in `f046ad3`.
5. **Finish report** — Written to `plans/history/2026.09/2026.09.03/publish-headless-mode.md`.

## Session narrative

### User requests
1. "modify d:\src\saropa_workspace\scripts\publish.py so that you can run it, respond to issue (ask me, or resolve on the fly), monitor output, and publish" — the core ask: make the publish pipeline driveable by an agent.
2. "yes and the run /finish skill" — confirmed the plan and asked for `/finish` at the end.
3. "1 and 2" — selected "Harden reflection items" and "Implement JSON output mode" from the reflection gate, plus "Update changelog and commit".

### Investigation & analysis
- Read all 11 modules under `scripts/modules/` to map every `input()` call. Found 7 interactive prompts across 4 files: `_workflow.py` (mode menu), `_version_changelog.py` (version prompt, Windows + Unix variants), `_utils.py` (failure handler), `_publish.py` (VSCE PAT, Open VSX PAT), `_ci.py` (local install).
- The `_QUIET` module-level global pattern in `_utils.py` was the established convention for cross-cutting flags. Used the same pattern for `_HEADLESS`, `_ON_FAILURE`, `_JSON_OUTPUT`.
- Identified that `prompt_on_failure` already had a non-tty stdin guard (auto-abort) but no headless-specific path.
- Code review (8 parallel finder angles at medium level) caught: unbounded retry loop, dead `get_on_failure()`, triplicated local imports, forward reference for `_VERSION_OVERRIDE`, stale `_HEADLESS_RETRIED` between steps, redundant `read_package_version()` call. Also flagged pre-existing issues in `_git_ops.py` (double-stash under retry, unguarded `rev-list` parsing) which were out of scope.

### Changes made
- **`scripts/publish.py`** — Added `--headless` (requires `--mode`), `--version`, `--on-failure`, `--json` args. `--json` implies `--quiet`. `--version` without `--headless` warns. JSON emitted via `get_last_run_result()` after `run_mode()`.
- **`scripts/modules/_utils.py`** — Added `_HEADLESS`, `_ON_FAILURE`, `_HEADLESS_RETRIED`, `_JSON_OUTPUT` globals with getters/setters. `prompt_on_failure()` headless branch with one-retry cap. `reset_headless_retry()` for per-step reset. `run()` captures subprocess output when `_JSON_OUTPUT`. `show_logo()` suppressed in quiet mode. CONTRACT comment for `input()` guards. Removed dead `get_on_failure()`.
- **`scripts/modules/_timing.py`** — Added `to_dict()` on `StepTimer` returning `{"steps": [...], "total_duration_s": float}`.
- **`scripts/modules/_version_changelog.py`** — Added `_VERSION_OVERRIDE` global (above first use) with `set_version_override()`. `prompt_version_until_valid()` returns override/default in headless; raises `ValueError` on bad semver. Hoisted `is_headless` to top-level import.
- **`scripts/modules/_publish.py`** — `_prompt_for_pat()` returns `""` in headless mode. Hoisted `is_headless` to top-level import.
- **`scripts/modules/_ci.py`** — `prompt_local_install()` returns immediately in headless mode. Hoisted `is_headless` to top-level import.
- **`scripts/modules/_workflow.py`** — Added `_record_result()` / `get_last_run_result()`. `_attempt()` calls `reset_headless_retry()` per step. `_resolve_version_interactive()` catches `ValueError`. `run_mode()` stores result in `finally` block. Added `GITHUB_REPO` import.
- **`CHANGELOG.md`** — Added entries for `--headless` and `--json` under `[Unreleased]`.
- **`plans/history/2026.09/2026.09.03/publish-headless-mode.md`** — Finish report.

### Decisions & trade-offs
- **Module-level globals over parameter threading** — Followed the existing `_QUIET` pattern. Simpler than threading headless/json through every function signature. Downside: implicit global state, but acceptable for a single-threaded CLI.
- **One-retry cap over configurable max** — `--on-failure retry` gives each step exactly one retry, then escalates to abort. Simpler than a `--max-retries N` flag; covers the 90% case (transient failure clears on one retry).
- **`--json` implies `--quiet`** — The JSON line must be the only stdout output. Subprocess capture is automatic in JSON mode. The logo is also suppressed.
- **`_run_publish_existing()` not wired for JSON** — Would require refactoring that function to use a StepTimer. Deferred; the fallback dict from `publish.py` is sufficient.
- **No enforcement for `input()` guards** — A CONTRACT comment rather than a lint rule. A lint rule would require a custom checker; the comment is pragmatic.

### Rejected / dismissed / deferred
- **Centralizing all prompts into one wrapper** — The altitude review suggested a single `interactive_prompt()` wrapper in `_utils.py`. Rejected for this session: each prompt has different fallback behavior (return "", return None, raise ValueError, apply policy), making a single abstraction premature without 3+ identical cases.
- **`--json-file <path>`** — Suggested as an unrequested feature (write JSON to a file while keeping colored terminal output). Deferred to a future session.
- **Fixing `_git_ops.py` double-stash and unguarded rev-list parsing** — Pre-existing issues, out of scope for this headless/JSON task.
- **Automated test suite for publish modules** — No test infrastructure exists. Would be valuable but is a separate project.

### User feedback & corrections
- No corrections. User confirmed the plan and selected all three reflection gate options ("1 and 2" for harden + JSON, commit implied).

## Key files & paths
- `scripts/publish.py` — CLI entry point, argument parsing
- `scripts/modules/_utils.py` — Shared globals (`_HEADLESS`, `_ON_FAILURE`, `_JSON_OUTPUT`), `prompt_on_failure()`, `run()`
- `scripts/modules/_timing.py` — `StepTimer` with `to_dict()`
- `scripts/modules/_workflow.py` — `run_mode()`, `_attempt()`, `_record_result()`
- `scripts/modules/_version_changelog.py` — `_VERSION_OVERRIDE`, `prompt_version_until_valid()`
- `scripts/modules/_publish.py` — `_prompt_for_pat()` headless guard
- `scripts/modules/_ci.py` — `prompt_local_install()` headless guard
- `plans/history/2026.09/2026.09.03/publish-headless-mode.md` — Finish report

## How to verify
1. `D:\Tools\Python\Python314\python.exe scripts\publish.py --help` — should show all 7 flags
2. `D:\Tools\Python\Python314\python.exe scripts\publish.py --headless --mode audit --json` — clean JSON only, exit 0
3. `D:\Tools\Python\Python314\python.exe scripts\publish.py --headless --mode dry-run --json` — JSON with timing steps
4. `D:\Tools\Python\Python314\python.exe scripts\publish.py --headless` — error: `--headless requires --mode`
5. `D:\Tools\Python\Python314\python.exe scripts\publish.py --version 2.0.0` — warning about ignored `--version`

## Gotchas & traps
- **`_JSON_OUTPUT` captures ALL subprocess output** — including from `run()` calls the caller expected to be visible. If debugging a headless failure, drop `--json` to see subprocess output.
- **`_HEADLESS_RETRIED` is per-process global state** — it's reset per step by `_attempt()`, but if someone calls `prompt_on_failure()` outside `_attempt()` (e.g. `_resolve_version_interactive`), the flag state may be stale.
- **Every new `input()` call MUST have `if is_headless(): return <default>`** — there's no lint rule enforcing this, only a CONTRACT comment in `_utils.py`. Grep for `input(` across `scripts/` to audit.
- **`show_logo()` is now suppressed by `--quiet`** — this is a behavior change from before this session. If someone relies on seeing the logo in quiet mode, it's gone.
- **The untracked file `bugs/proposal_infra_publish_rebase_debounce.md`** from session start was committed by a prior session (`5ab9da9`). It's no longer untracked.

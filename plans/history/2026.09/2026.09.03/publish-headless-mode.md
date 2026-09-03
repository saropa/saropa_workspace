# Publish script headless mode and JSON output

The publish pipeline (`scripts/publish.py`) was fully interactive — every
prompt (`input()`) required a human at the keyboard. An agent or CI pipeline
could not drive it without hanging on stdin, and had no machine-readable output
format.

## Finish Report (2026-09-03)

### Problem

Seven interactive prompts blocked unattended use: the mode menu, the version
prompt (Windows editable + Unix bracketed variants), the ignore/retry/abort
failure handler, two PAT paste prompts (VSCE and Open VSX), and the local
`.vsix` install offer. No CLI flags existed to bypass them. The only output
format was colored terminal text, unparseable by programmatic consumers.

### Solution

A `--headless` flag (requires `--mode`) disables all interactive prompts:

| Prompt | Headless behavior |
|---|---|
| Mode menu | Skipped — `--mode` is required |
| Version prompt | Accepts auto-computed default or `--version` override |
| Failure handler | Applies `--on-failure` policy (abort / ignore / retry) |
| PAT prompts | Skipped — env vars must be pre-set |
| Local install | Skipped entirely |

Supporting flags: `--version` (semver override), `--on-failure` (abort
default, ignore, or retry with a one-attempt cap per step).

A `--json` flag emits a single JSON object to stdout at exit containing mode,
version, exit code, per-step timing (name, duration, pass/fail), and (for full
publishes) marketplace and GitHub URLs. Implies `--quiet`; subprocess
stdout/stderr is captured so only the JSON line hits stdout. The logo is also
suppressed in quiet mode.

### Changes

- **`scripts/publish.py`**: Added `--headless`, `--version`, `--on-failure`,
  `--json` args. `--headless` requires `--mode`. `--json` implies `--quiet`.
  `--version` without `--headless` emits a warning. JSON is emitted via
  `get_last_run_result()` after the run completes.
- **`scripts/modules/_utils.py`**: Added `_HEADLESS`, `_ON_FAILURE`,
  `_HEADLESS_RETRIED`, `_JSON_OUTPUT` module globals with setters.
  `prompt_on_failure()` respects headless mode with a one-retry cap per step.
  `reset_headless_retry()` clears the flag between steps. `run()` captures
  subprocess output when `_JSON_OUTPUT` is active. `show_logo()` respressed in
  quiet mode. Added a CONTRACT comment documenting that every `input()` call
  must be guarded by `is_headless()`.
- **`scripts/modules/_timing.py`**: Added `to_dict()` on `StepTimer` for
  machine-readable step summaries.
- **`scripts/modules/_version_changelog.py`**: Added `_VERSION_OVERRIDE`
  global (above its first use) with `set_version_override()`.
  `prompt_version_until_valid()` accepts the override or default in headless
  mode; raises `ValueError` on bad semver.
- **`scripts/modules/_publish.py`**: `_prompt_for_pat()` returns empty string
  in headless mode (env var must be pre-set).
- **`scripts/modules/_ci.py`**: `prompt_local_install()` returns immediately
  in headless mode.
- **`scripts/modules/_workflow.py`**: Added `_record_result()` and
  `get_last_run_result()` to store structured run data for JSON consumers.
  `_resolve_version_interactive()` catches `ValueError` from headless version
  validation. `_attempt()` calls `reset_headless_retry()` per step.

### Code review findings addressed

- **Unbounded retry loop (correctness):** `--on-failure retry` in headless
  mode caused `_attempt()`'s `while True` to loop forever. Fixed with a
  one-attempt cap via `_HEADLESS_RETRIED` flag, reset per step.
- **Dead export:** Removed unused `get_on_failure()`.
- **Local imports:** Hoisted `is_headless` from function-local to top-level
  imports in `_ci.py`, `_publish.py`, `_version_changelog.py`.
- **Forward reference:** Moved `_VERSION_OVERRIDE` declaration above its
  first use in `prompt_version_until_valid()`.

### Hardening

- `_HEADLESS_RETRIED` resets between steps via `reset_headless_retry()` so a
  step that retries then succeeds does not poison the next step's retry budget.
- `--version` without `--headless` emits a warning instead of being silently
  ignored.
- `show_logo()` suppressed in `--quiet`/`--json` mode.
- `run()` captures subprocess output in `--json` mode so only the JSON line
  hits stdout.
- CONTRACT comment in `_utils.py` documents that every `input()` call must be
  guarded by `is_headless()`.

### Not addressed (pre-existing, out of scope)

- `sync_with_remote()` is not idempotent under retry (double-stash risk on
  rebase conflict).
- `git rev-list --left-right --count` output parsing is unguarded against
  shallow clones.

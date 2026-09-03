# Publish script headless mode

The publish pipeline (`scripts/publish.py`) was fully interactive — every
prompt (`input()`) required a human at the keyboard. An agent or CI pipeline
could not drive it without hanging on stdin.

## Finish Report (2026-09-03)

### Problem

Seven interactive prompts blocked unattended use: the mode menu, the version
prompt (Windows editable + Unix bracketed variants), the ignore/retry/abort
failure handler, two PAT paste prompts (VSCE and Open VSX), and the local
`.vsix` install offer. No CLI flags existed to bypass them.

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
default, ignore, or retry with a one-attempt cap).

### Changes

- **`scripts/publish.py`**: Added `--headless`, `--version`, `--on-failure`
  args. `--headless` requires `--mode`. Wires `set_headless()`,
  `set_on_failure()`, `set_version_override()`.
- **`scripts/modules/_utils.py`**: Added `_HEADLESS`, `_ON_FAILURE`,
  `_HEADLESS_RETRIED` module globals with setters. `prompt_on_failure()`
  respects headless mode with a one-retry cap to prevent infinite loops.
- **`scripts/modules/_version_changelog.py`**: Added `_VERSION_OVERRIDE`
  global with `set_version_override()`. `prompt_version_until_valid()` accepts
  the override or default in headless mode; raises `ValueError` on bad semver.
- **`scripts/modules/_publish.py`**: `_prompt_for_pat()` returns empty string
  in headless mode (env var must be pre-set).
- **`scripts/modules/_ci.py`**: `prompt_local_install()` returns immediately
  in headless mode.
- **`scripts/modules/_workflow.py`**: `_resolve_version_interactive()` catches
  `ValueError` from headless version validation.

### Code review findings addressed

- **Unbounded retry loop (correctness):** `--on-failure retry` in headless
  mode caused `_attempt()`'s `while True` to loop forever. Fixed with a
  one-attempt cap via `_HEADLESS_RETRIED` flag.
- **Dead export:** Removed unused `get_on_failure()`.
- **Local imports:** Hoisted `is_headless` from function-local to top-level
  imports in `_ci.py`, `_publish.py`, `_version_changelog.py`.
- **Forward reference:** Moved `_VERSION_OVERRIDE` declaration above its
  first use in `prompt_version_until_valid()`.

### Not addressed (pre-existing, out of scope)

- `sync_with_remote()` is not idempotent under retry (double-stash risk on
  rebase conflict).
- `git rev-list --left-right --count` output parsing is unguarded against
  shallow clones.

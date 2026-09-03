#!/usr/bin/env python3
"""
Publish the Saropa Workspace VS Code extension.

Single entry point for the release workflow: audit -> quality gate -> resolve
version -> build -> package the .vsix -> (optionally) publish to the VS Code
Marketplace and Open VSX -> commit, tag, push, create a GitHub release, then
verify the stores actually serve the new version.

This is a thin launcher. The workflow is split across scripts/modules/ so each
piece stays small and testable:

    modules/_utils.py             paths, constants, colored output, command runner
    modules/_timing.py            step timing and end-of-run summary
    modules/_version_changelog.py version + changelog reconciliation, prompts
    modules/_audit.py             release-correctness pre-flight (version, changelog, i18n)
    modules/_quality.py           code-quality metrics and gate (see also audit.py)
    modules/_build.py             doc sync, type check, build, package
    modules/_publish.py           PAT prompting, store publish, propagation verify
    modules/_git_ops.py           working tree, commit/tag/push, GitHub release
    modules/_ci.py                CI fallback playbook, local .vsix install
    modules/_workflow.py          mode orchestration (the pipelines below)

Run from anywhere in the repo:

    python scripts/publish.py

Modes (interactive menu, or pass --mode):
    full                Audit -> quality -> version -> build -> package -> publish -> git + release -> verify
    package             Build + package the .vsix only (no publish), optional local install
    publish-existing    Publish the newest existing .vsix (skip packaging) + verify
    dry-run             Audit + quality + build + package, never publish or touch git
    audit               Read-only pre-publish checks + quality report; change nothing
    ci-fallback         Print the manual release playbook (URLs, commands, files)

Headless mode (--headless --mode <mode>):
    Skips every interactive prompt so an agent or CI pipeline can drive the full
    publish without stdin. Version defaults to the auto-computed value (override
    with --version). PATs must be pre-set as environment variables. Step failures
    follow the --on-failure policy (abort | ignore | retry; default abort).

JSON output (--json):
    Emits a single JSON object to stdout at exit with mode, version, exit code,
    per-step timing, and (for full publishes) store URLs. Implies --quiet;
    subprocess output is captured. For programmatic consumers (agents, CI).

JSON file output (--json-file PATH):
    Writes the same JSON result object to PATH at exit. Does NOT imply --quiet,
    so colored terminal output remains visible. Useful when an agent needs both
    human-readable logs for debugging and machine-readable results. Can be
    combined with --json for both stdout and file output.

JSON schema (--json-schema):
    Prints the JSON Schema for the result object to stdout and exits. Agents can
    use this to validate their parsing logic without running a real publish.

Version handling is automated. The version source of truth is the top
"## [x.y.z]" section of the root CHANGELOG.md (which also holds the release
notes); extension/package.json is reconciled to it at publish time, with the
version prompt defaulting to the CHANGELOG version to confirm or overwrite.

Auth comes from the environment the CLIs expect:
    VSCE_PAT                    VS Code Marketplace (vsce publish)
    OVSX_PAT_SAROPA_WORKSPACE   Open VSX, per-extension token; mapped to the
                               generic OVSX_PAT (what `ovsx publish` reads) at
                               publish time so each Saropa extension's token
                               never collides in the shared slot.

Version:   3.0
Copyright: (c) 2026 Saropa

Exit codes:
    0  Success
    1  Prerequisites failed (missing tool / wrong directory)
    2  Working tree check failed
    3  Validation failed (version / changelog / audit / quality)
    4  Build failed
    5  Packaging failed
    6  Publish failed
    7  Git operations failed
    8  GitHub release failed
    10 User canceled
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add scripts/ to sys.path so `modules.*` resolves no matter the caller's cwd.
_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from modules._git_ops import DEFAULT_REBASE_DEBOUNCE_SECONDS, MAX_REBASE_DEBOUNCE_SECONDS  # noqa: E402
from modules._utils import detail, enable_ansi_support, set_headless, set_json_output, set_on_failure, set_quiet, show_logo  # noqa: E402
from modules._version_changelog import read_package_version, set_version_override  # noqa: E402
from modules._workflow import MODES, check_prerequisites, get_last_run_result, prompt_mode, run_mode  # noqa: E402


def _result_schema() -> dict:
    """JSON Schema describing the result object emitted by --json / --json-file.

    Kept here (not in a separate file) so the schema stays in lockstep with the
    code that builds the result dict in _workflow._record_result().
    """
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Saropa Workspace publish result",
        "type": "object",
        "required": ["mode", "exit_code", "ok"],
        "properties": {
            "mode": {
                "type": "string",
                "enum": list(MODES),
                "description": "The publish mode that was run.",
            },
            "exit_code": {
                "type": "integer",
                "description": "Process exit code (0 = success).",
            },
            "ok": {
                "type": "boolean",
                "description": "True when exit_code is 0.",
            },
            "version": {
                "type": "string",
                "pattern": r"^\d+\.\d+\.\d+",
                "description": "Semver version that was published or built.",
            },
            "timing": {
                "type": "object",
                "description": "Step-level timing data from StepTimer.to_dict().",
                "required": ["steps", "total_duration_s"],
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["name", "duration_s", "ok"],
                            "properties": {
                                "name": {"type": "string"},
                                "duration_s": {"type": "number"},
                                "ok": {"type": "boolean"},
                            },
                        },
                    },
                    "total_duration_s": {"type": "number"},
                },
            },
            "urls": {
                "type": "object",
                "description": "Store URLs (full-publish success only).",
                "properties": {
                    "marketplace": {"type": "string", "format": "uri"},
                    "open_vsx": {"type": "string", "format": "uri"},
                    "github_release": {"type": "string", "format": "uri"},
                },
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish the Saropa Workspace extension.")
    parser.add_argument("--mode", choices=MODES, help="Run non-interactively in the given mode.")
    parser.add_argument("--quiet", action="store_true", help="Only print warnings and errors.")
    parser.add_argument(
        "--rebase-debounce",
        type=int,
        default=DEFAULT_REBASE_DEBOUNCE_SECONDS,
        metavar="SECONDS",
        help="Seconds to wait after rebasing onto origin/main before restoring "
        f"stashed changes, letting file watchers settle. Default: {DEFAULT_REBASE_DEBOUNCE_SECONDS}, "
        f"0 disables, capped at {MAX_REBASE_DEBOUNCE_SECONDS}.",
    )
    parser.add_argument(
        "--headless", action="store_true",
        help="Skip all interactive prompts (for agent / CI use). Requires "
             "--mode. Version defaults to the auto-computed value; override with "
             "--version. PATs must be pre-set as env vars. Step failures follow "
             "the --on-failure policy.",
    )
    parser.add_argument(
        "--version",
        help="Override the version to publish (semver: X.Y.Z or X.Y.Z-pre.N). "
             "Only effective with --headless in a mode that resolves a version.",
    )
    parser.add_argument(
        "--on-failure", choices=("abort", "ignore", "retry"), default="abort",
        help="Failure policy in headless mode: abort (default), ignore, or retry.",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit a single JSON object to stdout at exit with mode, version, "
             "exit code, step timing, and store URLs. Implies --quiet.",
    )
    parser.add_argument(
        "--json-file", metavar="PATH",
        help="Write the JSON result object to PATH at exit. Unlike --json this "
             "does NOT imply --quiet, so colored terminal output remains visible. "
             "Can be combined with --json for both stdout and file output.",
    )
    parser.add_argument(
        "--json-schema", action="store_true",
        help="Print the JSON result schema to stdout and exit. Useful for agents "
             "to validate their parsing logic without running a real publish.",
    )
    parsed = parser.parse_args()

    # --json-schema prints the result schema and exits — no publish run needed.
    if parsed.json_schema:
        import json
        print(json.dumps(_result_schema(), indent=2))
        return 0

    # Validate --json-file path early so a bad path doesn't surface only after
    # the entire pipeline has finished.
    if parsed.json_file:
        json_file_path = Path(parsed.json_file)
        if not json_file_path.parent.exists():
            parser.error(f"--json-file directory does not exist: {json_file_path.parent}")

    # --json implies --quiet so the JSON line is the only stdout output.
    if parsed.json:
        set_quiet(True)
        set_json_output(True)
    else:
        set_quiet(parsed.quiet)

    # Headless mode requires --mode so the interactive menu is never shown.
    if parsed.headless and not parsed.mode:
        parser.error("--headless requires --mode")
    set_headless(parsed.headless)
    set_on_failure(parsed.on_failure)
    if parsed.version:
        # --version only takes effect in headless mode; warn if used without it
        # so the operator knows the override was ignored.
        if not parsed.headless:
            from modules._utils import warn
            warn("--version is ignored without --headless; the interactive prompt will appear.")
        set_version_override(parsed.version)

    enable_ansi_support()
    show_logo()
    mode = parsed.mode or prompt_mode()

    code = check_prerequisites(mode)
    if code:
        return code

    detail(f"  Saropa Workspace extension - version {read_package_version()}, mode '{mode}'.")
    exit_code = run_mode(mode, parsed.rebase_debounce)

    # Emit structured JSON for programmatic consumers (agents, CI dashboards).
    if parsed.json or parsed.json_file:
        import json
        result = get_last_run_result() or {"mode": mode, "exit_code": exit_code, "ok": exit_code == 0}
        payload = json.dumps(result, indent=2)
        if parsed.json:
            print(payload)
        if parsed.json_file:
            # Write to file so the agent gets JSON while the terminal keeps colored output.
            Path(parsed.json_file).write_text(payload, encoding="utf-8")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())

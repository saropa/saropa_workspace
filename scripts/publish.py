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

from modules._utils import detail, enable_ansi_support, set_quiet, show_logo  # noqa: E402
from modules._version_changelog import read_package_version  # noqa: E402
from modules._workflow import MODES, check_prerequisites, prompt_mode, run_mode  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish the Saropa Workspace extension.")
    parser.add_argument("--mode", choices=MODES, help="Run non-interactively in the given mode.")
    parser.add_argument("--quiet", action="store_true", help="Only print warnings and errors.")
    parsed = parser.parse_args()
    set_quiet(parsed.quiet)

    enable_ansi_support()
    show_logo()
    mode = parsed.mode or prompt_mode()

    code = check_prerequisites(mode)
    if code:
        return code

    detail(f"  Saropa Workspace extension - version {read_package_version()}, mode '{mode}'.")
    return run_mode(mode)


if __name__ == "__main__":
    sys.exit(main())

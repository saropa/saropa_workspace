#!/usr/bin/env python3
"""
Mode orchestration for the release toolchain.

Holds the prerequisite check, the interactive mode menu, and the pipelines that
wire the step modules together for each mode: full publish, package-only,
publish-existing, dry-run, audit-only, and the CI fallback playbook. Keeping the
control flow here lets publish.py stay a thin entry point.

Version:   1.0
Copyright: (c) 2026 Saropa
"""

from __future__ import annotations

import re
import shutil

from modules._audit import run_audit
from modules._build import build, newest_vsix, package_vsix, type_check
from modules._ci import ci_fallback, prompt_local_install
from modules._git_ops import check_working_tree, git_commit_release, github_release
from modules._publish import publish_marketplaces, success_banner, verify_store_publication
from modules._quality import run_quality_audit
from modules._timing import StepTimer
from modules._utils import (
    PACKAGE_JSON,
    VERSION_RE,
    detail,
    fail,
    header,
    success,
)
from modules._version_changelog import read_package_version, resolve_version

MODES = ("full", "package", "publish-existing", "dry-run", "audit", "ci-fallback")


def check_prerequisites(mode: str) -> int:
    if not PACKAGE_JSON.exists():
        return fail(f"extension/package.json not found at {PACKAGE_JSON}", 1)
    required = ["npm", "npx"]
    if mode in ("full", "audit", "ci-fallback"):
        required += ["git"]
    if mode == "full":
        required += ["gh"]
    missing = [tool for tool in required if shutil.which(tool) is None]
    if missing:
        return fail(f"Required tools not found on PATH: {', '.join(missing)}", 1)
    return 0


def prompt_mode() -> str:
    header("PUBLISH OPTIONS")
    detail("  1) Full publish (audit -> quality -> version -> build -> package -> publish -> git + release -> verify)")
    detail("  2) Package only (build + .vsix, no publish; optional local install)")
    detail("  3) Publish existing .vsix (skip build/package) + verify")
    detail("  4) Dry run (audit + quality + build + package, never publish)")
    detail("  5) Audit only (read-only checks + quality report; change nothing)")
    detail("  6) CI fallback playbook (manual release URLs and commands)")
    try:
        choice = input("  Choice [1]: ").strip() or "1"
    except (EOFError, KeyboardInterrupt):
        return "full"
    return {
        "1": "full",
        "2": "package",
        "3": "publish-existing",
        "4": "dry-run",
        "5": "audit",
        "6": "ci-fallback",
    }.get(choice, "full")


def _run_publish_existing() -> int:
    timer = StepTimer()
    try:
        vsix = newest_vsix()
        if vsix is None:
            return fail("No existing .vsix to publish; run package first.", 6)
        success(f"Selected: {vsix.name}")
        version_match = re.search(rf"-({VERSION_RE})\.vsix$", vsix.name)
        with timer.step("Publish"):
            code = publish_marketplaces()
        if code:
            return code
        if version_match:
            verify_store_publication(version_match.group(1))
        return 0
    finally:
        timer.print_summary()


def run_mode(mode: str) -> int:
    """Dispatch to the pipeline for *mode*. Returns the process exit code."""
    if mode == "ci-fallback":
        return ci_fallback()

    if mode == "audit":
        # Audit-only reports both gates; the publish audit decides the exit code,
        # the quality report is informational here (non-strict).
        publish_failures = run_audit(mode)
        run_quality_audit(strict=False)
        return 3 if publish_failures else 0

    if mode == "publish-existing":
        return _run_publish_existing()

    # Build-and-maybe-publish modes (full, package, dry-run).
    timer = StepTimer()
    try:
        strict = mode == "full"
        if run_audit(mode) and strict:
            return fail("Audit failed; fix the issues above before a full publish.", 3)
        # Quality gate: blocks a full publish on hard violations, informational otherwise.
        if run_quality_audit(strict=strict) and strict:
            return fail("Quality gate failed; fix the issues above before a full publish.", 3)

        version: str | None = read_package_version()
        if strict:
            version = resolve_version(timer)
            if version is None:
                return 10
            check_working_tree()

        with timer.step("Type check"):
            code = type_check()
        if code:
            return code
        with timer.step("Build"):
            code = build()
        if code:
            return code
        with timer.step("Package"):
            code = package_vsix(version)
        if code:
            return code

        if mode in ("package", "dry-run"):
            header("DONE")
            success("Package built. No publish performed for this mode.")
            if mode == "package":
                prompt_local_install()
            return 0

        # Full publish: stores -> git tag/release -> store verification.
        with timer.step("Publish"):
            code = publish_marketplaces()
        if code:
            return code
        with timer.step("Git + release"):
            code = git_commit_release(version) or github_release(version)
        if code:
            return code
        verify_store_publication(version)
        success_banner(version)
        return 0
    finally:
        timer.print_summary()

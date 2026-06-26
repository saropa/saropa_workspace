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
    prompt_on_failure,
    success,
    warn,
)
from modules._version_changelog import read_package_version, resolve_version

MODES = ("full", "package", "publish-existing", "dry-run", "audit", "ci-fallback")


def _attempt(label, step, *, timer: StepTimer | None = None) -> tuple[int, bool]:
    """Run *step* (a callable returning 0 on success, non-zero on failure).

    On any failure the operator chooses ignore / retry (default) / abort. Retry
    re-runs *step* from scratch, so a transient failure (registry hiccup, an
    expired token just renewed, a file just fixed) clears without restarting the
    whole pipeline. The retry default makes this the single failure policy for
    every step in the run.

    Returns (code, aborted):
      - passed or ignored -> (0, False)
      - aborted           -> (the failing code, True)
    """
    while True:
        if timer is not None:
            with timer.step(label):
                code = step()
        else:
            code = step()
        if not code:
            return 0, False
        choice = prompt_on_failure(label)
        if choice == "retry":
            continue
        if choice == "ignore":
            warn(f"{label}: failure ignored by request; continuing.")
            return 0, False
        return (code if isinstance(code, int) else 1), True


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


def _resolve_version_interactive(timer: StepTimer) -> str | None:
    """resolve_version() wrapped in the standard ignore / retry / abort policy.

    resolve_version returns None when the changelog can't be reconciled (an empty
    stub, a duplicate heading, a post-sync top-vs-package mismatch). Retry re-runs
    it after the author fixes the file; ignore falls back to the current
    package.json version so the publish can proceed unchanged; abort stops.
    """
    while True:
        version = resolve_version(timer)
        if version is not None:
            return version
        choice = prompt_on_failure("Version")
        if choice == "retry":
            continue
        if choice == "ignore":
            fallback = read_package_version()
            warn(f"Version resolution failed; falling back to package.json {fallback}.")
            return fallback
        return None


def _run_publish_existing() -> int:
    timer = StepTimer()
    try:
        vsix = newest_vsix()
        if vsix is None:
            return fail("No existing .vsix to publish; run package first.", 6)
        success(f"Selected: {vsix.name}")
        version_match = re.search(rf"-({VERSION_RE})\.vsix$", vsix.name)
        code, aborted = _attempt("Publish", publish_marketplaces, timer=timer)
        if aborted:
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

        # Gates block only a full publish. In package/dry-run they are
        # informational, so a non-strict "failure" is not a stop and never
        # prompts; only the strict path routes a gate failure through the
        # ignore/retry/abort choice.
        if strict:
            _, aborted = _attempt("Audit", lambda: run_audit(mode))
            if aborted:
                return fail("Audit aborted; fix the issues above before a full publish.", 3)
            _, aborted = _attempt("Quality gate", lambda: run_quality_audit(strict=True))
            if aborted:
                return fail("Quality gate aborted; fix the issues above before a full publish.", 3)
        else:
            run_audit(mode)
            run_quality_audit(strict=False)

        version: str | None = read_package_version()
        if strict:
            version = _resolve_version_interactive(timer)
            if version is None:
                return 10
            check_working_tree()

        # Each build step shares one failure policy: ignore / retry (default) / abort.
        for label, step in (
            ("Type check", type_check),
            ("Build", build),
            ("Package", lambda: package_vsix(version)),
        ):
            code, aborted = _attempt(label, step, timer=timer)
            if aborted:
                return code

        if mode in ("package", "dry-run"):
            header("DONE")
            success("Package built. No publish performed for this mode.")
            if mode == "package":
                prompt_local_install()
            return 0

        # Full publish: stores -> git tag/release -> store verification.
        code, aborted = _attempt("Publish", publish_marketplaces, timer=timer)
        if aborted:
            return code
        code, aborted = _attempt(
            "Git + release",
            lambda: git_commit_release(version) or github_release(version),
            timer=timer,
        )
        if aborted:
            return code
        verify_store_publication(version)
        success_banner(version)
        return 0
    finally:
        timer.print_summary()

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
from modules._git_ops import (
    DEFAULT_REBASE_DEBOUNCE_SECONDS,
    check_working_tree,
    git_commit_release,
    github_release,
    sync_with_remote,
)
from modules._publish import publish_marketplaces, success_banner, verify_store_publication
from modules._quality import run_quality_audit
from modules._timing import StepTimer
from modules._utils import (
    GITHUB_REPO,
    PACKAGE_JSON,
    VERSION_RE,
    detail,
    error,
    fail,
    header,
    prompt_on_failure,
    reset_headless_retry,
    success,
    warn,
)
from modules._version_changelog import read_package_version, resolve_version

MODES = ("full", "package", "publish-existing", "dry-run", "audit", "ci-fallback")

# Populated by run_mode for JSON output consumers. Contains mode, version, exit
# code, step timing, and (for full publishes) store URLs.
_last_run_result: dict | None = None


def get_last_run_result() -> dict | None:
    """Return the structured result of the most recent run_mode call."""
    return _last_run_result


def _attempt(
    label, step, *, timer: StepTimer | None = None, allow_ignore: bool = True
) -> tuple[int, bool]:
    """Run *step* (a callable returning 0 on success, non-zero on failure).

    On any failure the operator chooses ignore / retry (default) / abort. Retry
    re-runs *step* from scratch, so a transient failure (registry hiccup, an
    expired token just renewed, a file just fixed) clears without restarting the
    whole pipeline. The retry default makes this the single failure policy for
    every step in the run.

    *allow_ignore* gates the "ignore" choice (interactive or the headless
    --on-failure=ignore policy). A step is left False when a failure means the
    working tree is in an unsafe intermediate state to build on top of — e.g. a
    rebase or stash-pop failure in the Git sync step, which can leave conflict
    markers or a half-restored stash. Silently "ignoring" that and continuing
    into the build/commit steps would risk shipping the conflict, so it is
    forced to abort instead.

    Returns (code, aborted):
      - passed or ignored -> (0, False)
      - aborted           -> (the failing code, True)
    """
    # Give this step its own headless retry budget — see reset_headless_retry()'s
    # docstring for why a leftover flag from the previous step must not leak in.
    reset_headless_retry()
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
            if not allow_ignore:
                error(f"{label}: failure cannot be ignored — the working tree may be in an unsafe state; aborting.")
                return (code if isinstance(code, int) else 1), True
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
    """Show the interactive mode menu and return the chosen mode.

    Never called in headless mode — the --mode arg is required there.
    """
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

    In headless mode a bad --version raises ValueError, which is surfaced as an
    error and treated as an abort — there is no interactive fix path.
    """
    reset_headless_retry()
    while True:
        try:
            version = resolve_version(timer)
        except ValueError as exc:
            # Headless: invalid --version; no interactive recovery possible.
            error(str(exc))
            return None
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


def _record_result(mode: str, exit_code: int, version: str | None = None,
                    timer: StepTimer | None = None) -> None:
    """Store a structured run result for JSON output consumers."""
    global _last_run_result
    result: dict = {"mode": mode, "exit_code": exit_code, "ok": exit_code == 0}
    if version:
        result["version"] = version
    if timer:
        result["timing"] = timer.to_dict()
    # For full publishes, include the store URLs so an agent can link them.
    if mode == "full" and exit_code == 0 and version:
        from modules._publish import _extension_identity
        publisher, name = _extension_identity()
        if publisher and name:
            result["urls"] = {
                "marketplace": f"https://marketplace.visualstudio.com/items?itemName={publisher}.{name}",
                "open_vsx": f"https://open-vsx.org/extension/{publisher}/{name}",
                "github_release": f"https://github.com/{GITHUB_REPO}/releases/tag/v{version}",
            }
    _last_run_result = result


def run_mode(mode: str, rebase_debounce_seconds: int = DEFAULT_REBASE_DEBOUNCE_SECONDS) -> int:
    """Dispatch to the pipeline for *mode*. Returns the process exit code."""
    if mode == "ci-fallback":
        code = ci_fallback()
        _record_result(mode, code)
        return code

    if mode == "audit":
        # Audit-only reports both gates; the publish audit decides the exit code,
        # the quality report is informational here (non-strict).
        publish_failures = run_audit(mode)
        run_quality_audit(strict=False)
        code = 3 if publish_failures else 0
        _record_result(mode, code)
        return code

    if mode == "publish-existing":
        return _run_publish_existing()

    # Build-and-maybe-publish modes (full, package, dry-run).
    timer = StepTimer()
    exit_code = 0
    version: str | None = read_package_version()
    try:
        strict = mode == "full"

        # Gates block only a full publish. In package/dry-run they are
        # informational, so a non-strict "failure" is not a stop and never
        # prompts; only the strict path routes a gate failure through the
        # ignore/retry/abort choice.
        if strict:
            _, aborted = _attempt(
                "Git sync", lambda: sync_with_remote(rebase_debounce_seconds), allow_ignore=False
            )
            if aborted:
                exit_code = fail("Remote sync aborted; resolve the rebase before a full publish.", 7)
                return exit_code
            _, aborted = _attempt("Audit", lambda: run_audit(mode))
            if aborted:
                exit_code = fail("Audit aborted; fix the issues above before a full publish.", 3)
                return exit_code
            _, aborted = _attempt("Quality gate", lambda: run_quality_audit(strict=True))
            if aborted:
                exit_code = fail("Quality gate aborted; fix the issues above before a full publish.", 3)
                return exit_code
        else:
            run_audit(mode)
            run_quality_audit(strict=False)

        if strict:
            version = _resolve_version_interactive(timer)
            if version is None:
                exit_code = 10
                return exit_code
            check_working_tree()

        # Each build step shares one failure policy: ignore / retry (default) / abort.
        for label, step in (
            ("Type check", type_check),
            ("Build", build),
            ("Package", lambda: package_vsix(version)),
        ):
            code, aborted = _attempt(label, step, timer=timer)
            if aborted:
                exit_code = code
                return exit_code

        if mode in ("package", "dry-run"):
            header("DONE")
            success("Package built. No publish performed for this mode.")
            if mode == "package":
                prompt_local_install()
            return 0

        # Full publish: stores -> git tag/release -> store verification.
        code, aborted = _attempt("Publish", publish_marketplaces, timer=timer)
        if aborted:
            exit_code = code
            return exit_code
        code, aborted = _attempt(
            "Git + release",
            lambda: git_commit_release(version) or github_release(version),
            timer=timer,
            allow_ignore=False,
        )
        if aborted:
            exit_code = code
            return exit_code
        verify_store_publication(version)
        success_banner(version)
        return 0
    finally:
        timer.print_summary()
        _record_result(mode, exit_code, version, timer)
